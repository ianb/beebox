#!/usr/bin/env node
// Shared, project-scoped process reclamation for the callback-box dev router.
//
// The router's pidfiles only ever record the *current* generation of each
// worktree (single-slot `<name>.json`), so older leaked generations and
// agent-browser daemons are invisible to pidfile-based cleanup. This module
// finds those processes by pattern — strictly scoped to this project's paths —
// and reclaims them under two safety rules:
//
//   1. Scope. Only ever touch `vite`/`fastify` whose executable or cwd is
//      under the monorepo (MAIN_ROOT) or the worktrees root, and
//      `agent-browser` whose binary is under one of those node_modules. Never
//      a blanket `pkill vite` / `pkill agent-browser`.
//   2. Live sessions + current-daemon. An agent-browser is left alone only
//      when its worktree has a live agent session (claude OR codex) AND it's
//      the daemon the worktree's socket dir currently vouches for (its pid is
//      in a `*.pid` file). Killing the in-use daemon would sabotage active
//      work; but the superseded orphans (idle daemons that stopped serving yet
//      never exit — see below) are reaped even in a live worktree, which is the
//      whole reason they otherwise pile up.
//
//      Liveness is TRI-STATE — none / live / unknown — and `unknown` counts as
//      live (in fact stricter — see classifyAgentBrowser), because this guard
//      stands in front of an irreversible kill. The
//      answer comes from `bin/workstreams agent-liveness`, i.e. from
//      `wt_other_agent_live` in bin/lib/worktree-teardown.sh, the single shared
//      implementation. This module used to carry its own two-state copy that
//      knew only `claude --worktree <name>` argv plus `pgrep -x claude`; that
//      copy was blind to codex sessions entirely (now the default worker agent)
//      and, because a native-installed Claude Code reports its VERSION as the
//      accounting name pgrep matches, blind to most claude sessions too. It
//      reclaimed a live Codex worktree's browser daemon. Extend the shared
//      guard; never grow a second one here.
//
// Why parentage works for vite/fastify but not agent-browser: vite/fastify are
// only ever spawned by the router, so a project vite/fastify whose parent is
// PID 1 is by definition an orphan of a *dead* router. A live router — including
// a second isolated test router — keeps its children parented to itself
// (detached:true changes the process group, not the parent), so they show a
// live ppid and are skipped. agent-browser daemons, by contrast, detach all the
// way to PID 1 even while their owning session is alive, so they can't be told
// apart by parentage — they're gated on the live-session + socket-dir pidfile
// check instead. (The upstream daemon also never exits on idle: it stops
// serving its socket but lingers at PID 1, so a fresh one spawns on next use
// and the dead ones accumulate — the pidfile check is what reaps them.)
//
// Used by bin/router.ts (startup sweep, aggressive:false) and by
// `bin/workstreams panic` (run directly as a CLI, aggressive:true).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execa } from "execa";

// Mirror bin/router.ts's roots (including the CALLBACK_MAIN_ROOT override) so
// scoping stays identical. CALLBACK_WORKTREE_ROOT is the same override
// bin/lib/worktree-paths.sh honors — the basename under the parent is
// convention, not something git knows, and a test needs to point both halves at
// a scratch tree rather than at the developer's real worktrees.
const MAIN_ROOT = process.env.CALLBACK_MAIN_ROOT || path.join(os.homedir(), "src", "callback-box");
const WORKTREES_ROOT = process.env.CALLBACK_WORKTREE_ROOT || path.join(os.homedir(), "src", "callback-worktrees");

// This file's own directory — where `workstreams` (the liveness oracle) lives.
const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));

// Per-worktree agent-browser socket dirs, mirroring `bin/browse`
// (`${HOME}/.cache/callback-box/browse/<worktree>/socket`). Each dir's
// `*.pid` files (default.pid, dashboard.pid, <session>.pid) name the only
// agent-browser processes that are actually live for that worktree.
const BROWSE_CACHE_ROOT = path.join(os.homedir(), ".cache", "callback-box", "browse");

const KILL_GRACE_MS = 2000;

// How old an unvouched agent-browser must be before we are willing to call it
// an orphan. A freshly spawned daemon has no `*.pid` file yet: measured on
// 2026-08-24, `bin/browse` puts agent-browser processes on the process table at
// T+1s and its socket dir stays empty until T+3s. Anything younger than this is
// indistinguishable from a daemon another session started a moment ago, and
// "indistinguishable" resolves to "don't kill" everywhere else in this file.
// Generous on purpose: the cost of waiting is one lingering process until the
// next sweep, the cost of being wrong is a live session losing its browser.
//
// The override exists because the guard is defined in terms of process age and
// a test's fake daemons are necessarily seconds old — there is no way to
// exercise the reaping half of the predicate without it.
const MIN_ORPHAN_AGE_SEC = ((): number => {
  const raw = process.env.CB_CLEANUP_MIN_ORPHAN_AGE_SEC;
  if (raw === undefined || raw === "") return 60;
  const n = Number(raw);
  // A malformed value must not disable the guard: `NaN` loses every comparison,
  // so `ageSec < NaN` would be false for any process and every young unvouched
  // daemon would be killable again — the exact bug this constant exists to stop.
  return Number.isFinite(n) && n >= 0 ? n : 60;
})();

export type ProcKind = "vite" | "fastify" | "agent-browser";

/** Agent liveness, mirroring `wt_other_agent_live`'s WT_AGENT_STATE. */
export type AgentState = "none" | "launching" | "live" | "unknown";

export interface AgentLiveness {
  state: AgentState;
  reason: string;
}

export interface ProjectProc {
  pid: number;
  ppid: number;
  kind: ProcKind;
  /** "main" or the worktree name the process belongs to. */
  worktree: string;
  command: string;
  /** Wall-clock seconds since the process started (`ps etime`). */
  ageSec: number;
}

export interface ReclaimResult {
  killed: ProjectProc[];
  spared: ProjectProc[];
}

interface PsRow {
  pid: number;
  ppid: number;
  ageSec: number;
  command: string;
}

/** Map an absolute path to its owning worktree ("main" or a worktree name). */
function worktreeForPath(p: string): string | null {
  const wtPrefix = WORKTREES_ROOT + path.sep;
  if (p.startsWith(wtPrefix)) {
    const seg = p.slice(wtPrefix.length).split(path.sep)[0];
    return seg ? seg : null;
  }
  if (p === MAIN_ROOT || p.startsWith(MAIN_ROOT + path.sep)) return "main";
  return null;
}

/**
 * The agent-browser pids a worktree's socket dir currently vouches for — read
 * from its `*.pid` files (the live daemon `default.pid`, the `dashboard.pid`,
 * and any per-session `<name>.pid`). Any *other* agent-browser process for that
 * worktree is a superseded orphan: the upstream daemon stops serving its socket
 * on idle/supersession but never exits — it reparents to PID 1 and sleeps
 * forever — so a fresh daemon is spawned on next use and the old one lingers,
 * one per generation. Missing dir / unreadable pidfile → empty set (nothing
 * vouched for, so every agent-browser there is reapable).
 */
async function currentDaemonPids(worktree: string): Promise<Set<number>> {
  const sockDir = path.join(BROWSE_CACHE_ROOT, worktree, "socket");
  const live = new Set<number>();
  let entries: string[];
  try {
    entries = await fs.readdir(sockDir);
  } catch {
    return live;
  }
  await Promise.all(
    entries
      .filter((f) => f.endsWith(".pid"))
      .map(async (f) => {
        try {
          const pid = Number((await fs.readFile(path.join(sockDir, f), "utf8")).trim());
          if (Number.isFinite(pid) && pid > 0) live.add(pid);
        } catch { /* unreadable pidfile — ignore */ }
      }),
  );
  return live;
}

/**
 * Seconds from a `ps etime` field (`[[dd-]hh:]mm:ss`). Returns `Infinity` for
 * anything unparseable: an unreadable age must not read as "young", which is
 * the value that spares a process from an otherwise-correct reap.
 */
export function etimeToSeconds(etime: string): number {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return Infinity;
  const [days, hours, mins, secs] = [m[1] ?? "0", m[2] ?? "0", m[3]!, m[4]!].map(Number);
  return ((days! * 24 + hours!) * 60 + mins!) * 60 + secs!;
}

async function psRows(): Promise<PsRow[]> {
  const { stdout } = await execa("ps", ["-axo", "pid=,ppid=,etime=,command="]);
  const rows: PsRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), ageSec: etimeToSeconds(m[3]!), command: m[4]! });
  }
  return rows;
}

/** cwd of each pid via lsof, best-effort (some pids may be unreadable). */
async function cwdOf(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  let stdout = "";
  try {
    ({ stdout } = await execa("lsof", ["-a", "-d", "cwd", "-p", pids.join(","), "-Fn"]));
  } catch (e) {
    // lsof exits non-zero if *any* listed pid is gone, but still prints the
    // rest on stdout — recover whatever it managed to emit.
    stdout = (e as { stdout?: string }).stdout ?? "";
  }
  let cur = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) cur = Number(line.slice(1));
    else if (line.startsWith("n") && cur) out.set(cur, line.slice(1));
  }
  return out;
}

/** Absolute path of a worktree name as this module attributes them. */
function pathForWorktree(worktree: string): string {
  return worktree === "main" ? MAIN_ROOT : path.join(WORKTREES_ROOT, worktree);
}

/**
 * Tri-state agent liveness per worktree, from `bin/workstreams agent-liveness`
 * — which is `wt_other_agent_live`, the one shared guard, and therefore knows
 * about codex sessions and about claude sessions whose argv is `--name`.
 *
 * FAILS CLOSED. Every worktree starts at `unknown` (which callers must treat as
 * live), and only a successful, parseable answer moves it. A missing or broken
 * oracle therefore spares daemons rather than reclaiming them: the cost of
 * sparing is a lingering process the next sweep reaps, the cost of reclaiming
 * is a live session losing its browser mid-task.
 */
export async function agentLivenessByWorktree(worktrees: string[]): Promise<Map<string, AgentLiveness>> {
  const out = new Map<string, AgentLiveness>(
    worktrees.map((wt) => [wt, { state: "unknown" as AgentState, reason: "liveness-oracle-unavailable" }]),
  );
  if (worktrees.length === 0) return out;
  let stdout: string;
  try {
    ({ stdout } = await execa(path.join(BIN_DIR, "workstreams"), [
      "agent-liveness",
      ...worktrees.map(pathForWorktree),
    ]));
  } catch {
    return out;
  }
  let parsed: { ok?: boolean; paths?: Record<string, { state?: string; reason?: string }> };
  try {
    parsed = JSON.parse(stdout) as typeof parsed;
  } catch {
    return out;
  }
  if (parsed.ok !== true || !parsed.paths) return out;
  for (const wt of worktrees) {
    const entry = parsed.paths[pathForWorktree(wt)];
    if (!entry) continue;
    // Anything that isn't a state we recognize stays `unknown` — a guard must
    // not read a value it doesn't understand as permission to kill.
    const recognized = entry.state === "live" || entry.state === "launching" || entry.state === "none";
    const state: AgentState = recognized ? entry.state as AgentState : "unknown";
    out.set(wt, { state, reason: entry.reason ?? "" });
  }
  return out;
}

/**
 * Should this agent-browser be reclaimed? Split out from the sweep so the
 * decision is testable without spawning processes.
 *
 * - `none`    — nothing is using this worktree; every daemon there is reapable.
 * - `live`    — spare the daemon the socket dir vouches for; superseded orphans
 *               still go (they never exit on their own).
 * - `launching` — spare unconditionally while setup owns an active lease. A
 *               pre-agent shell cannot establish which daemon is current yet.
 *
 * In every branch that reaps an UNVOUCHED process, `ageSec` gates it: a daemon
 * younger than MIN_ORPHAN_AGE_SEC has not had time to write its pidfile, so
 * "not vouched for" carries no information about it yet. That window is the
 * whole of issues/bugs/2026-08-21-browse-reaper-kills-other-sessions-daemons.md
 * — two agents in one worktree, and the one that runs second kills the
 * still-starting daemon of the first.
 * - `unknown` — spare unconditionally, vouched or not. This is stricter than
 *               "treat unknown as live", deliberately: reaping a superseded
 *               orphan rests entirely on the socket dir's pidfiles, and with the
 *               liveness answer already unavailable there is no second signal
 *               left to be wrong about. Two silent failures at once — an oracle
 *               that won't run and a pidfile that can't be read — would
 *               otherwise kill the daemon of a session that is very much alive.
 *               The cost is the opposite failure, a lingering daemon, which the
 *               next sweep collects once the oracle answers again.
 */
export function classifyAgentBrowser(
  session: AgentState,
  vouched: boolean,
  ageSec: number,
): { kill: boolean; reason: string } {
  if (session === "launching") return { kill: false, reason: "launch in progress" };
  if (session === "unknown") return { kill: false, reason: "session liveness unknown" };
  if (!vouched && ageSec < MIN_ORPHAN_AGE_SEC) {
    return { kill: false, reason: `starting (${Math.round(ageSec)}s old, no pidfile yet)` };
  }
  if (session === "none") return { kill: true, reason: "no live session" };
  if (!vouched) return { kill: true, reason: "superseded orphan" };
  return { kill: false, reason: "current daemon" };
}

/** All project-scoped vite / fastify / agent-browser processes. */
export async function discoverProjectProcs(): Promise<ProjectProc[]> {
  const rows = await psRows();
  const procs: ProjectProc[] = [];
  const fastifyCandidates: PsRow[] = [];

  for (const r of rows) {
    // vite — bin path encodes the root: `<root>/node_modules/.bin/vite dev …`
    const vite = r.command.match(/(\/\S+)\/node_modules\/\.bin\/vite\b/);
    if (vite) {
      const wt = worktreeForPath(vite[1]!);
      if (wt) { procs.push({ pid: r.pid, ppid: r.ppid, kind: "vite", worktree: wt, command: r.command, ageSec: r.ageSec }); }
      continue;
    }
    // agent-browser — `<root>/node_modules/agent-browser/bin/agent-browser-*`
    const ab = r.command.match(/(\/\S+)\/node_modules\/agent-browser\//);
    if (ab) {
      const wt = worktreeForPath(ab[1]!);
      if (wt) { procs.push({ pid: r.pid, ppid: r.ppid, kind: "agent-browser", worktree: wt, command: r.command, ageSec: r.ageSec }); }
      continue;
    }
    // fastify — the callback-box backend. Its server-main.ts path is relative
    // in argv, so the worktree is attributed from the process cwd below.
    if (/(^|\s)\S*src\/webapp\/server-main\.ts\b/.test(r.command) && /--import\b/.test(r.command)) {
      fastifyCandidates.push(r);
    }
  }

  if (fastifyCandidates.length > 0) {
    const cwds = await cwdOf(fastifyCandidates.map((r) => r.pid));
    for (const r of fastifyCandidates) {
      const cwd = cwds.get(r.pid);
      const wt = cwd ? worktreeForPath(cwd) : null;
      if (wt) procs.push({ pid: r.pid, ppid: r.ppid, kind: "fastify", worktree: wt, command: r.command, ageSec: r.ageSec });
    }
  }

  return procs;
}

/** SIGTERM/SIGKILL the process group, falling back to the bare pid. */
function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reclaim orphaned project processes.
 *
 * - `aggressive: false` (router startup sweep): kill vite/fastify only when
 *   orphaned to PID 1 (a live router's children are spared).
 * - `aggressive: true` (panic): kill all project vite/fastify regardless of
 *   parentage (the router is being nuked anyway, which orphans them).
 *
 * agent-browser daemons are reaped the same way in both modes: spared only when
 * their worktree has a live session AND their pid is the one its socket dir
 * currently vouches for (a `*.pid` entry) — or when liveness is unknown, which
 * spares regardless. A worktree with no session at all has every daemon
 * reaped; a live
 * worktree keeps its current daemon + dashboard but sheds superseded orphans
 * (which never exit on their own). The hard rule — never kill a daemon a live
 * session is actually using — is preserved, just sharpened from "any daemon of
 * a live worktree" to "the current one."
 */
export async function reclaimOrphans(opts: {
  aggressive: boolean;
  log?: (msg: string) => void;
}): Promise<ReclaimResult> {
  const log = opts.log ?? (() => {});
  const procs = await discoverProjectProcs();

  // For each worktree that has agent-browser procs: whether an agent is live in
  // it, and the pids its socket dir currently vouches for. An agent-browser is
  // spared only if both say so; everything else — a whole worktree that's done,
  // or a superseded orphan in a live one — is reaped. Only worktrees that
  // actually own daemons are asked about, so the common (nothing to reap) case
  // costs no process snapshot at all.
  const abWorktrees = [...new Set(procs.filter((p) => p.kind === "agent-browser").map((p) => p.worktree))];
  const currentByWt = new Map<string, Set<number>>();
  const [sessions] = await Promise.all([
    agentLivenessByWorktree(abWorktrees),
    Promise.all(abWorktrees.map(async (wt) => { currentByWt.set(wt, await currentDaemonPids(wt)); })),
  ]);

  // An unknown answer spares daemons, so it must not be silent: a permanently
  // broken oracle would otherwise look exactly like a quiet, healthy sweep while
  // the daemons pile up.
  for (const [wt, liveness] of sessions) {
    if (liveness.state === "unknown") log(`liveness unknown for ${wt} (${liveness.reason}) — sparing its daemons`);
  }

  const killed: ProjectProc[] = [];
  const spared: ProjectProc[] = [];

  for (const p of procs) {
    let doKill: boolean;
    let abReason = "";
    if (p.kind === "agent-browser") {
      const session = sessions.get(p.worktree)?.state ?? "unknown";
      const vouched = currentByWt.get(p.worktree)?.has(p.pid) ?? false;
      ({ kill: doKill, reason: abReason } = classifyAgentBrowser(session, vouched, p.ageSec));
    } else {
      doKill = opts.aggressive || p.ppid === 1;
    }
    const why = p.kind === "agent-browser" ? abReason : `ppid ${p.ppid}`;
    if (!doKill) {
      spared.push(p);
      log(`spare ${p.kind} pid ${p.pid} (${p.worktree}, ${why})`);
      continue;
    }
    killed.push(p);
    log(`reclaim ${p.kind} pid ${p.pid} (${p.worktree}, ${why})`);
    signal(p.pid, "SIGTERM");
  }

  if (killed.length > 0) {
    await sleep(KILL_GRACE_MS);
    for (const p of killed) signal(p.pid, "SIGKILL");
  }
  return { killed, spared };
}

/**
 * Reap this worktree's superseded agent-browser daemons, for `bin/browse` to
 * call before it runs a command. The upstream daemon stops serving its socket
 * on idle but never exits, so without this they accumulate one per generation.
 *
 * Scoped to ONE worktree and to agent-browser only — no vite/fastify, no other
 * worktree, and no `lsof`, so it costs a single `ps`.
 *
 * The liveness oracle is not consulted and does not need to be: the caller is
 * itself a live user of this worktree, which is exactly the `live` answer the
 * oracle would return. Passing it directly saves a subprocess on every browse
 * command without weakening the guard — `live` is the stricter of the two
 * answers a running worktree could get.
 *
 * `bin/browse` used to carry its own bash copy of this decision, which knew
 * only about pidfiles and therefore killed any daemon that had not written one
 * yet. That is the second copy this module's header forbids; it is gone.
 */
export async function reclaimWorktreeBrowsers(opts: {
  worktree: string;
  log?: (msg: string) => void;
}): Promise<ReclaimResult> {
  const log = opts.log ?? (() => {});
  const rows = await psRows();
  const procs: ProjectProc[] = [];
  for (const r of rows) {
    const ab = r.command.match(/(\/\S+)\/node_modules\/agent-browser\//);
    if (!ab) continue;
    if (worktreeForPath(ab[1]!) !== opts.worktree) continue;
    procs.push({
      pid: r.pid, ppid: r.ppid, kind: "agent-browser",
      worktree: opts.worktree, command: r.command, ageSec: r.ageSec,
    });
  }
  if (procs.length === 0) return { killed: [], spared: [] };

  const vouchedPids = await currentDaemonPids(opts.worktree);
  const killed: ProjectProc[] = [];
  const spared: ProjectProc[] = [];
  for (const p of procs) {
    const { kill, reason } = classifyAgentBrowser("live", vouchedPids.has(p.pid), p.ageSec);
    if (!kill) {
      spared.push(p);
      continue;
    }
    killed.push(p);
    log(`reclaim agent-browser pid ${p.pid} (${opts.worktree}, ${reason})`);
    signal(p.pid, "SIGTERM");
  }
  return { killed, spared };
}

// CLI entry: `node process-cleanup.ts [panic]`. Without `panic` it runs the
// session-safe sweep (the same one the router runs on startup); with `panic`
// it nukes project vite/fastify too. Run directly only — importing is a no-op.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const aggressive = process.argv.includes("panic") || process.argv.includes("--aggressive");
  reclaimOrphans({ aggressive, log: (m) => console.log(`[cleanup] ${m}`) })
    .then(({ killed, spared }) => {
      console.log(`[cleanup] reclaimed ${killed.length}, spared ${spared.length}`);
      process.exit(0);
    })
    .catch((e: Error) => {
      console.error(`[cleanup] failed: ${e.message}`);
      process.exit(1);
    });
}
