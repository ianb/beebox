#!/usr/bin/env node
// Shared, project-scoped process reclamation for the callback-mono dev router.
//
// The router's pidfiles only ever record the *current* generation of each
// worktree (single-slot `<name>.json`), so older leaked generations and
// agent-browser daemons are invisible to pidfile-based cleanup. This module
// finds those processes by pattern — strictly scoped to this project's paths —
// and reclaims them under two safety rules:
//
//   1. Scope. Only ever touch `vite`/`fastify` whose executable or cwd is
//      under the monorepo (MAIN_ROOT) or ~/src/callback-worktrees, and
//      `agent-browser` whose binary is under one of those node_modules. Never
//      a blanket `pkill vite` / `pkill agent-browser`.
//   2. Active sessions. An agent-browser owned by a worktree with a live
//      `claude` session is left alone — killing it would sabotage active work.
//
// Why parentage works for vite/fastify but not agent-browser: vite/fastify are
// only ever spawned by the router, so a project vite/fastify whose parent is
// PID 1 is by definition an orphan of a *dead* router. A live router — including
// a second isolated test router — keeps its children parented to itself
// (detached:true changes the process group, not the parent), so they show a
// live ppid and are skipped. agent-browser daemons, by contrast, detach all the
// way to PID 1 even while their owning session is alive, so they can't be told
// apart by parentage — they're gated on the active-session check instead.
//
// Used by bin/router.ts (startup sweep, aggressive:false) and by
// `bin/worktrees panic` (run directly as a CLI, aggressive:true).

import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execa } from "execa";

// Mirror bin/router.ts's roots (including the CALLBACK_MAIN_ROOT override) so
// scoping stays identical. WORKTREES_ROOT is fixed by convention.
const MAIN_ROOT = process.env.CALLBACK_MAIN_ROOT || path.join(os.homedir(), "src", "callback-mono");
const WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees");

const KILL_GRACE_MS = 2000;

export type ProcKind = "vite" | "fastify" | "agent-browser";

export interface ProjectProc {
  pid: number;
  ppid: number;
  kind: ProcKind;
  /** "main" or the worktree name the process belongs to. */
  worktree: string;
  command: string;
}

export interface ReclaimResult {
  killed: ProjectProc[];
  spared: ProjectProc[];
}

interface PsRow {
  pid: number;
  ppid: number;
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

async function psRows(): Promise<PsRow[]> {
  const { stdout } = await execa("ps", ["-axo", "pid=,ppid=,command="]);
  const rows: PsRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! });
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

/**
 * Worktrees with a live `claude` session, by two signals (mirrors the
 * precedent in `bin/worktrees sweep`):
 *   1. argv — sessions launched as `claude --worktree <name>`.
 *   2. cwd  — sessions resumed in-place lack that argv, but the claude
 *      process's cwd is inside the worktree (or the main checkout).
 */
export async function activeSessionWorktrees(): Promise<Set<string>> {
  const active = new Set<string>();
  const rows = await psRows();
  for (const r of rows) {
    const m = r.command.match(/claude --worktree ([A-Za-z0-9_-]+)/);
    if (m) active.add(m[1]!);
  }
  let pidLines = "";
  try {
    ({ stdout: pidLines } = await execa("pgrep", ["-x", "claude"]));
  } catch {
    pidLines = ""; // no claude processes
  }
  const claudePids = pidLines
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const cwds = await cwdOf(claudePids);
  for (const cwd of cwds.values()) {
    const wt = worktreeForPath(cwd);
    if (wt) active.add(wt);
  }
  return active;
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
      if (wt) { procs.push({ pid: r.pid, ppid: r.ppid, kind: "vite", worktree: wt, command: r.command }); }
      continue;
    }
    // agent-browser — `<root>/node_modules/agent-browser/bin/agent-browser-*`
    const ab = r.command.match(/(\/\S+)\/node_modules\/agent-browser\//);
    if (ab) {
      const wt = worktreeForPath(ab[1]!);
      if (wt) { procs.push({ pid: r.pid, ppid: r.ppid, kind: "agent-browser", worktree: wt, command: r.command }); }
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
      if (wt) procs.push({ pid: r.pid, ppid: r.ppid, kind: "fastify", worktree: wt, command: r.command });
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
 *   orphaned to PID 1 (a live router's children are spared); kill
 *   agent-browsers whose worktree has no active session.
 * - `aggressive: true` (panic): kill all project vite/fastify regardless of
 *   parentage (the router is being nuked anyway, which orphans them). Active
 *   sessions' agent-browsers are STILL spared — the hard rule is never to kill
 *   a process owned by an active worktree session.
 */
export async function reclaimOrphans(opts: {
  aggressive: boolean;
  log?: (msg: string) => void;
}): Promise<ReclaimResult> {
  const log = opts.log ?? (() => {});
  const [procs, active] = await Promise.all([discoverProjectProcs(), activeSessionWorktrees()]);
  const killed: ProjectProc[] = [];
  const spared: ProjectProc[] = [];

  for (const p of procs) {
    let doKill: boolean;
    if (p.kind === "agent-browser") {
      doKill = !active.has(p.worktree);
    } else {
      doKill = opts.aggressive || p.ppid === 1;
    }
    if (!doKill) {
      spared.push(p);
      log(`spare ${p.kind} pid ${p.pid} (${p.worktree}${p.kind === "agent-browser" ? ", active session" : `, ppid ${p.ppid}`})`);
      continue;
    }
    killed.push(p);
    log(`reclaim ${p.kind} pid ${p.pid} (${p.worktree}, ppid ${p.ppid})`);
    signal(p.pid, "SIGTERM");
  }

  if (killed.length > 0) {
    await sleep(KILL_GRACE_MS);
    for (const p of killed) signal(p.pid, "SIGKILL");
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
