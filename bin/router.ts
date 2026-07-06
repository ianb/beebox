#!/usr/bin/env node
// Dev router for the callback-box monorepo.
//
// Listens on a single user-facing port (default 3210) and lazily spawns a
// Vite + Fastify pair for each worktree on first request to that worktree's
// URL prefix. URLs look like:
//
//   http://localhost:3210/main/test1/dashboard         → main checkout
//   http://localhost:3210/foo/test1/inbox/...          → worktree "foo"
//
// One child per process per worktree, owned directly by the router (no tmux,
// no overmind). Process tree is router → {vite, fastify} per worktree.
//
// Vite is configured with `base: '/<name>/'` so it serves its own assets at
// the prefixed paths. HMR connects directly to Vite's internal port,
// bypassing this router entirely.
//
// Orphan resistance:
//   - Each spawned child is recorded in ~/.cache/callback-box/pids/<name>.json
//   - On router startup, that directory is swept: any PID still alive is
//     killed (it's from a previous router that crashed); any dead PID's
//     file is removed.
//   - On clean SIGTERM/SIGINT, every active worktree is killed before exit.
//   - On idle (5 min default), individual worktrees self-shutdown.

import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import type { Socket } from "node:net";
import { execa, type ResultPromise } from "execa";
import getPort from "get-port";
import httpProxy from "http-proxy-3";
import { reclaimOrphans } from "./process-cleanup.js";
import { resolveBoxEntries, boxEntryToArg, type ResolvedBoxEntry } from "./box-entry.js";
import Markdoc from "@markdoc/markdoc";
import hljs from "highlight.js";

type ChildProc = ResultPromise<{ stdio: ["ignore", "pipe", "pipe"]; detached: true; cleanup: true }>;

interface ErrnoError extends Error {
  code?: string;
}

interface StatusError extends Error {
  statusCode?: number;
}

// --- Configuration -----------------------------------------------------

const ROUTER_PORT = Number(process.env.ROUTER_PORT) || 3210;
const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
// Where /main/ is served from. Defaults to the canonical checkout so that a
// router started from a worktree (e.g. while iterating on router.ts itself)
// still serves real-main at /main/, not the worktree's stale snapshot of main.
// Override with CALLBACK_MAIN_ROOT for non-standard layouts.
const MAIN_ROOT = process.env.CALLBACK_MAIN_ROOT || path.join(os.homedir(), "src", "callback-box");
const WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees");
const BOXES_ROOT = path.join(os.homedir(), "src", "box-worktrees");
// Overridable so a second router can run isolated (tests, dev on the router
// itself) without fighting the live one over pid files and port state.
const STATE_DIR = process.env.CALLBACK_STATE_DIR || path.join(os.homedir(), ".cache", "callback-box");
const LOG_DIR = path.join(STATE_DIR, "logs");
const PID_DIR = path.join(STATE_DIR, "pids");
const BROWSE_DIR = path.join(STATE_DIR, "browse");
const ROUTER_PID_FILE = path.join(STATE_DIR, "router.pid");

const AGENT_BROWSER_BIN = path.join(REPO_ROOT, "node_modules", "agent-browser", "bin", "agent-browser.js");

// The /dev/ space: a place the *dev-repo agent* (Claude Code, not a box) builds
// things for you to view in the browser — HTML visualizations, rendered
// Markdown reports, data displays. Served from the tracked dev/ directory
// (committed, unlike the gitignored scratch/), so these views are kept.
const DEV_ROOT = path.join(REPO_ROOT, "dev");
const DEV_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
};

function browseDirsFor(name: string): { base: string; socketDir: string; profileDir: string } {
  const base = path.join(BROWSE_DIR, name);
  return { base, socketDir: path.join(base, "socket"), profileDir: path.join(base, "profile") };
}

const IDLE_TIMEOUT_MS = Number(process.env.ROUTER_IDLE_MS) || 5 * 60 * 1000;
const KILL_GRACE_MS = 2000;

// Boxholder directive (2026-07-04): each worktree's backend is now a
// per-worktree `cb hub` (lazy: true, idleMs matching IDLE_TIMEOUT_MS above)
// instead of one `server-main.ts` Fastify process serving every box in the
// worktree's BOXES list. This gives each BOX its own process, lazily
// started and idle-collected — the same semantics this router already gives
// whole worktrees — composing cleanly with the router's own lazy/idle
// worktree layer: the router still lazy-starts/idle-stops the WORKTREE
// (vite + hub), and the hub now separately lazy-starts/idle-stops each BOX
// within it. One release of insurance while this beds in: CB_DEV_NO_HUB=1
// reverts to spawning server-main.ts directly, the old one-process-many-
// boxes shape (Track G's prior escape hatch). Delete this flag once the
// hub path has proven itself — tracked in docs/implemented-plans/boxes-as-packages-v2.md.
const DEV_NO_HUB = process.env.CB_DEV_NO_HUB === "1";
const HUB_CONFIG_DIR = path.join(STATE_DIR, "hub-configs");

const MAIN_BOX_DEFAULTS = [
  path.join(os.homedir(), "src", "boxes", "hearthside"),
  path.join(os.homedir(), "src", "boxes", "test1"),
  path.join(os.homedir(), "src", "boxes", "hearth-test"),
  path.join(os.homedir(), "src", "boxes", "studio"),
  path.join(os.homedir(), "src", "boxes", "meta-cb"),
  path.join(os.homedir(), "src", "boxes", "ia-review"),
];

// --- Worktree resolution -----------------------------------------------

interface ResolvedWorktree {
  name: string;
  root: string;
  backendCwd: string;
  frontendCwd: string;
  boxes: string[];
}

async function resolveWorktree(name: string): Promise<ResolvedWorktree | null> {
  if (name === "main") {
    return {
      name: "main",
      root: MAIN_ROOT,
      backendCwd: path.join(MAIN_ROOT, "callback-box"),
      frontendCwd: path.join(MAIN_ROOT, "callback-box", "src", "frontend"),
      boxes:
        (await readBoxes(path.join(MAIN_ROOT, "callback-box", ".env"))) ??
        MAIN_BOX_DEFAULTS,
    };
  }
  const root = path.join(WORKTREES_ROOT, name);
  try {
    await fs.access(root);
  } catch {
    return null;
  }
  const envPath = path.join(root, "callback-box", ".env");
  const boxes = await readBoxes(envPath);
  return {
    name,
    root,
    backendCwd: path.join(root, "callback-box"),
    frontendCwd: path.join(root, "callback-box", "src", "frontend"),
    boxes: boxes ?? [path.join(BOXES_ROOT, name, "test1")],
  };
}

async function readBoxes(envPath: string): Promise<string[] | null> {
  try {
    const text = await fs.readFile(envPath, "utf8");
    const line = text.split("\n").find((l) => l.startsWith("BOXES="));
    if (!line) return null;
    return line.slice("BOXES=".length).trim().split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}

// --- PID file management ----------------------------------------------

interface PidRecord {
  name: string;
  vitePid: number | undefined;
  fastifyPid: number | undefined;
  frontendPort: number;
  backendPort: number;
  dashboardPort: number | null;
  socketDir: string;
  profileDir: string;
  routerPid: number;
  startedAt: number;
}

async function writePidFile(name: string, data: PidRecord): Promise<void> {
  await fs.mkdir(PID_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PID_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}

// Remove a worktree's pidfile. The pidfile is single-slot (`<name>.json`),
// holding only the *current* generation — so a teardown that races a fresh
// start must NOT delete a pidfile that a newer generation has already written,
// or that generation becomes invisible to the startup sweep (an untracked
// orphan if the router later dies). Callers that know which generation they're
// tearing down pass `expect`; removal is skipped when the on-disk record names
// different pids. Generation-agnostic callers (shutdown) omit it.
async function removePidFile(
  name: string,
  expect?: { vitePid: number | undefined; fastifyPid: number | undefined },
): Promise<void> {
  const fullPath = path.join(PID_DIR, `${name}.json`);
  if (expect) {
    try {
      const data = JSON.parse(await fs.readFile(fullPath, "utf8")) as Partial<PidRecord>;
      if (data.vitePid !== expect.vitePid || data.fastifyPid !== expect.fastifyPid) {
        // A newer generation owns the slot now — leave it alone.
        return;
      }
    } catch {
      // Missing or unreadable — fall through to the unlink (a no-op if gone).
    }
  }
  try {
    await fs.unlink(fullPath);
  } catch {
    // Already gone — fine.
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as ErrnoError).code === "EPERM";
  }
}

async function sweepStaleChildren(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(PID_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(PID_DIR, file);
    let data: Partial<PidRecord>;
    try {
      data = JSON.parse(await fs.readFile(fullPath, "utf8"));
    } catch {
      await fs.unlink(fullPath).catch(() => {});
      continue;
    }
    for (const pid of [data.vitePid, data.fastifyPid]) {
      if (typeof pid !== "number") continue;
      if (!pidAlive(pid)) continue;
      log(`sweep: killing leftover pid ${pid} from ${file}`);
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
      }
    }
    if (typeof data.socketDir === "string") {
      try {
        const dashPidStr = await fs.readFile(path.join(data.socketDir, "dashboard.pid"), "utf8");
        const dashPid = Number.parseInt(dashPidStr.trim(), 10);
        if (Number.isFinite(dashPid) && pidAlive(dashPid)) {
          log(`sweep: killing leftover dashboard pid ${dashPid} from ${file}`);
          try { process.kill(dashPid, "SIGTERM"); } catch { /* gone */ }
        }
      } catch { /* no dashboard pidfile, fine */ }
    }
    await fs.unlink(fullPath).catch(() => {});
  }
}

// --- Process supervision ----------------------------------------------

type EntryState = "starting" | "ready" | "stopping" | "dead" | "failed";

interface CapturedError {
  message: string;
  /** Which lifecycle phase failed (waitForHttp, spawn, etc.). */
  phase: string;
  /** Tail of stdout+stderr (interleaved) from each child. Both streams are
   *  captured because some startup output (fastify's "Server running at …",
   *  vite's box-listing) lands on stdout, not stderr. */
  viteOutput: string;
  fastifyOutput: string;
  at: number;
}

/**
 * Fixed-size in-memory ring buffer for capturing the tail of a child's
 * stdout+stderr (interleaved). Used by the failed-startup UI so the user
 * can see what went wrong without grepping the log file. `write` is
 * byte-counted (UTF-8 after Buffer→string conversion).
 */
function makeOutputRing(maxBytes: number): { write: (s: string) => void; read: () => string } {
  let buf = "";
  return {
    write(s) {
      buf += s;
      if (buf.length > maxBytes) buf = buf.slice(buf.length - maxBytes);
    },
    read() { return buf; },
  };
}

interface WorktreeEntry {
  state: EntryState;
  name: string;
  startPromise?: Promise<WorktreeEntry>;
  vite?: ChildProc;
  fastify?: ChildProc;
  frontendPort?: number;
  backendPort?: number;
  dashboardPort: number | null;
  dashboardUrl: string | null;
  socketDir?: string;
  profileDir?: string;
  browseEnv?: NodeJS.ProcessEnv;
  startedAt?: number;
  lastActivity?: number;
  idleTimer: NodeJS.Timeout | null;
  logFile?: string;
  /** Populated when state === "failed". Surfaced on the error page so the
   *  user can see what went wrong without grepping the log. */
  lastError?: CapturedError;
}

const worktrees = new Map<string, WorktreeEntry>();

async function ensureRunning(name: string): Promise<WorktreeEntry> {
  const existing = worktrees.get(name);
  if (existing?.state === "ready") {
    touch(existing);
    return existing;
  }
  if (existing?.startPromise) return existing.startPromise;
  // Failed worktrees stay failed until the user explicitly retries (via the
  // /__router/retry/<name> endpoint). Auto-restarting on every page-fetch
  // would mask the failure and burn CPU / log noise — a broken worktree
  // should *look* broken, with the captured error visible.
  if (existing?.state === "failed" && existing.lastError) {
    const err: StatusError = new Error(existing.lastError.message);
    err.statusCode = 502;
    throw err;
  }

  // Register the placeholder and its startPromise *atomically* — there must be
  // NO await between the worktrees.get() above and the worktrees.set() below,
  // or two near-simultaneous cold requests for the same worktree both observe
  // an empty map, both call startWorktree, and each spawns a full vite+fastify
  // pair. Only the last startWorktree to resolve wins the map slot; the loser's
  // pair stays alive but unreferenced (a leaked generation), and its eventual
  // exit is swallowed by onChildExit's replaced-generation guard. The old code
  // awaited resolveWorktree() here, before registering — which is exactly the
  // window that leaked. startWorktree does its own resolveWorktree()/404 check,
  // so we no longer need (or want) one before the placeholder.
  const placeholder: WorktreeEntry = {
    state: "starting",
    name,
    dashboardPort: null,
    dashboardUrl: null,
    idleTimer: null,
  };
  placeholder.startPromise = startWorktree(name);
  worktrees.set(name, placeholder);
  // On rejection that ISN'T a captured waitForHttp failure (e.g. an
  // unknown-name 404 from a `/.well-known/...` probe, crawler, or typo —
  // startWorktree throws before parking a "failed" entry), drop the bare
  // placeholder so it leaves no phantom index entry and a later valid request
  // can retry. The waitForHttp path replaces the map entry with its own
  // "failed" record, so the `cur === placeholder` guard leaves that intact.
  placeholder.startPromise.catch(() => {
    const cur = worktrees.get(name);
    if (cur === placeholder && cur.state === "starting") worktrees.delete(name);
  });
  return placeholder.startPromise;
}

/**
 * Generate this worktree's `hub.json`, written fresh on every (re)start
 * (single-slot per worktree, like the pidfile) so a `BOXES=` edit in the
 * worktree's `.env` or a resolved-slug change always takes effect on the
 * next cold start. `port` is the worktree's own dynamically-assigned
 * `backendPort` — Vite's `vite.config.ts` proxies `/<box>/api/...` etc. to
 * `http://localhost:BACKEND_PORT`, and the hub's own routing (unprefixed,
 * first-path-segment slug matching — see `src/hub/hub-server.ts`) composes
 * with that unchanged: Vite already stripped the worktree's own `/<name>`
 * prefix before proxying, so the hub sees exactly `/<slug>/...`, the same
 * shape it expects from a production request. `lazy: true` + `idleMs:
 * IDLE_TIMEOUT_MS` give each BOX the same lazy-start/idle-collect semantics
 * this router already gives each WORKTREE. No `GOOGLE_OAUTH_CLIENT_ID` is
 * set here (this config carries no auth fields at all) — the hub's own
 * `isAuthEnabled()` reads it from the hub PROCESS's inherited env, exactly
 * as `server-main.ts` always did directly, so dev's "open on localhost
 * unless you've configured OAuth" behavior is unchanged; a hub-mode box
 * child never re-checks its OWN `GOOGLE_OAUTH_CLIENT_ID` for identity
 * either way (`resolveRequestIdentity` short-circuits on `isHubMode()`).
 */
async function writeWorktreeHubConfig(params: {
  name: string;
  backendPort: number;
  resolvedBoxes: ResolvedBoxEntry[];
}): Promise<string> {
  const { name, backendPort, resolvedBoxes } = params;
  await fs.mkdir(HUB_CONFIG_DIR, { recursive: true });
  const configPath = path.join(HUB_CONFIG_DIR, `${name}.json`);
  const boxes: Record<string, { path: string }> = {};
  for (const { slug, contentDir } of resolvedBoxes) boxes[slug] = { path: contentDir };
  await fs.writeFile(
    configPath,
    JSON.stringify({ port: backendPort, host: "127.0.0.1", lazy: true, idleMs: IDLE_TIMEOUT_MS, boxes }, null, 2),
  );
  return configPath;
}

let touch = (entry: WorktreeEntry): void => {
  entry.lastActivity = Date.now();
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    log(`[${entry.name}] idle for ${IDLE_TIMEOUT_MS}ms, shutting down`);
    stopWorktree(entry.name).catch((err: Error) =>
      log(`[${entry.name}] idle shutdown error: ${err.message}`),
    );
  }, IDLE_TIMEOUT_MS);
  entry.idleTimer.unref();
};

async function startWorktree(name: string): Promise<WorktreeEntry> {
  const wt = await resolveWorktree(name);
  if (!wt) {
    const err: StatusError = new Error(`Worktree ${JSON.stringify(name)} not found`);
    err.statusCode = 404;
    throw err;
  }
  log(`[${name}] starting`);

  await fs.mkdir(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n=== router start ${new Date().toISOString()} ===\n`);

  const [frontendPort, backendPort, dashboardPort] = await Promise.all([getPort(), getPort(), getPort()]);
  const { socketDir, profileDir } = browseDirsFor(name);
  await Promise.all([
    fs.mkdir(socketDir, { recursive: true }),
    fs.mkdir(profileDir, { recursive: true }),
  ]);

  const baseUrl = `/${name}/`;
  // --disable-warning=DEP0040 silences the punycode deprecation that
  // transitive deps (ajv@6, node-fetch 2) trigger on every node start.
  const nodeOptions = [process.env.NODE_OPTIONS, "--disable-warning=DEP0040"]
    .filter(Boolean)
    .join(" ");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    VITE_BASE: baseUrl,
    PORT: String(backendPort),
    NODE_OPTIONS: nodeOptions,
  };
  const browseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_PROFILE: profileDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
  };

  log(`[${name}] frontend=${frontendPort} backend=${backendPort} dashboard=${dashboardPort} base=${baseUrl}`);

  // Each of wt.boxes may be a legacy box dir, a v2 package root, or a v2
  // content dir (see box-entry.ts) — resolve to {contentDir, slug} before
  // handing off to the backend, which no longer guesses the slug itself.
  const resolvedBoxes = await resolveBoxEntries(wt.boxes);
  const backendArgs = DEV_NO_HUB
    ? ["./src/webapp/server-main.ts", ...resolvedBoxes.map(boxEntryToArg)]
    : [
        "./src/cli/index.ts",
        "hub",
        "--config",
        await writeWorktreeHubConfig({ name, backendPort, resolvedBoxes }),
      ];
  const fastify = execa(
    "node",
    ["--import=./tsx-preload.mjs", "--import", "tsx", ...backendArgs],
    {
      cwd: wt.backendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    },
  ) as ChildProc;
  // Swallow the execa promise rejection immediately — even on the
  // failure path of startWorktree below. Without this the rejection
  // becomes an unhandledRejection minutes later (when the killed child
  // finally exits) and crashes the whole router. Was an actual bug
  // until 2026-06-04 — see git log for context.
  fastify.catch(() => { /* handled via .on("exit") + failed-state UX */ });
  fastify.stdout?.pipe(logStream, { end: false });
  fastify.stderr?.pipe(logStream, { end: false });
  const fastifyOutputRing = makeOutputRing(8 * 1024);
  fastify.stdout?.on("data", (d: Buffer) => fastifyOutputRing.write(d.toString("utf8")));
  fastify.stderr?.on("data", (d: Buffer) => fastifyOutputRing.write(d.toString("utf8")));

  // pnpm workspace with `node-linker=hoisted` (see /.npmrc) puts all binaries
  // at the workspace root's node_modules/.bin — per-package node_modules/.bin
  // dirs aren't populated. Resolve vite from the worktree's monorepo root.
  const viteBin = path.join(wt.root, "node_modules", ".bin", "vite");
  const vite = execa(
    viteBin,
    ["dev", "--port", String(frontendPort)],
    {
      cwd: wt.frontendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    },
  ) as ChildProc;
  vite.catch(() => { /* see fastify.catch above — same reason */ });
  vite.stdout?.pipe(logStream, { end: false });
  vite.stderr?.pipe(logStream, { end: false });
  const viteOutputRing = makeOutputRing(8 * 1024);
  vite.stdout?.on("data", (d: Buffer) => viteOutputRing.write(d.toString("utf8")));
  vite.stderr?.on("data", (d: Buffer) => viteOutputRing.write(d.toString("utf8")));

  // Kill any orphaned dashboard daemon for this socket dir before starting a new one.
  await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
    env: browseEnv,
    stdio: "ignore",
    timeout: 5000,
  }).catch(() => { /* nothing to stop, fine */ });

  let dashboardStarted = false;
  try {
    await execa("node", [AGENT_BROWSER_BIN, "dashboard", "start", "--port", String(dashboardPort)], {
      env: browseEnv,
      stdio: "ignore",
      timeout: 15000,
    });
    dashboardStarted = true;
    log(`[${name}] dashboard ready on :${dashboardPort}`);
  } catch (err) {
    log(`[${name}] dashboard failed to start: ${(err as Error).message}`);
  }

  await writePidFile(name, {
    name,
    vitePid: vite.pid,
    fastifyPid: fastify.pid,
    frontendPort,
    backendPort,
    dashboardPort: dashboardStarted ? dashboardPort : null,
    socketDir,
    profileDir,
    routerPid: process.pid,
    startedAt: Date.now(),
  });

  // Wait for both to serve HTTP — not just accept TCP.
  try {
    await Promise.all([
      waitForHttp(frontendPort, baseUrl, 30000, `vite/${name}`),
      waitForHttp(backendPort, "/healthz", 30000, `fastify/${name}`),
    ]);
  } catch (err) {
    // Match the SIGTERM→SIGKILL escalation of the other teardown paths: a vite
    // that's slow to die on SIGTERM (e.g. mid esbuild/optimizeDeps) would
    // otherwise survive as an orphan, and we've already removed its pidfile
    // below so the sweep couldn't find it either.
    killGroup(vite.pid);
    killGroup(fastify.pid);
    setTimeout(() => {
      killGroup(vite.pid, "SIGKILL");
      killGroup(fastify.pid, "SIGKILL");
    }, KILL_GRACE_MS).unref();
    // The dashboard daemon started before waitForHttp; stop it too so a failed
    // startup doesn't leak an agent-browser process.
    if (dashboardStarted) {
      await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
        env: browseEnv,
        stdio: "ignore",
        timeout: 5000,
      }).catch(() => { /* nothing to stop, fine */ });
    }
    await removePidFile(name, { vitePid: vite.pid, fastifyPid: fastify.pid });
    // Park the entry in `failed` with what we captured. The HTTP request
    // handler (and /__router/retry/<name>) reads `lastError` to render
    // the error page; ensureRunning won't auto-restart a failed worktree.
    const captured: CapturedError = {
      message: (err as Error).message,
      phase: "waitForHttp",
      viteOutput: viteOutputRing.read(),
      fastifyOutput: fastifyOutputRing.read(),
      at: Date.now(),
    };
    log(`[${name}] startup failed in ${captured.phase}: ${captured.message}`);
    worktrees.set(name, {
      state: "failed",
      name,
      dashboardPort: null,
      dashboardUrl: null,
      idleTimer: null,
      lastError: captured,
    });
    const wrapped: StatusError = new Error(captured.message);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  const entry: WorktreeEntry = {
    state: "ready",
    name,
    vite,
    fastify,
    frontendPort,
    backendPort,
    dashboardPort: dashboardStarted ? dashboardPort : null,
    dashboardUrl: dashboardStarted ? `http://localhost:${dashboardPort}/` : null,
    socketDir,
    profileDir,
    browseEnv,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    idleTimer: null,
    logFile,
  };
  worktrees.set(name, entry);
  touch(entry);
  log(`[${name}] ready`);

  vite.on("exit", (code, signal) => {
    log(`[${name}] vite exited code=${code} signal=${signal}`);
    onChildExit(name, entry);
  });
  fastify.on("exit", (code, signal) => {
    log(`[${name}] fastify exited code=${code} signal=${signal}`);
    onChildExit(name, entry);
  });
  // execa-promise rejection handlers are attached at spawn time above — not
  // here — so they're in place even on the waitForHttp-failure path.

  return entry;
}

// A child's exit event can arrive long after its generation was replaced —
// fastify drains open browser sockets for ~10s after SIGTERM, by which time a
// reconnecting client has often already spawned the next generation under the
// same name. Tearing down by name alone let those late exits kill the *new*
// generation, which the client then restarted, killing the next one: a
// self-sustaining restart storm with a fresh vite port every cycle (the
// 2026-06-09 "main restarts every 10s" incident). Every teardown must
// therefore verify the exiting child belongs to the entry currently in the
// map, and stale exits reduce to a log line.
let onChildExit = (name: string, exited: WorktreeEntry): void => {
  const entry = worktrees.get(name);
  if (entry !== exited) {
    log(`[${name}] exit event from a replaced generation, ignoring`);
    return;
  }
  if (!entry || entry.state !== "ready") return;
  entry.state = "dead";
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  setTimeout(() => {
    killGroup(entry.vite?.pid, "SIGKILL");
    killGroup(entry.fastify?.pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  worktrees.delete(name);
  stopDashboard(entry).catch(() => {});
  removePidFile(name, { vitePid: entry.vite?.pid, fastifyPid: entry.fastify?.pid }).catch(() => {});
};

let stopWorktree = async (name: string): Promise<void> => {
  const entry = worktrees.get(name);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.state = "stopping";
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  setTimeout(() => {
    killGroup(entry.vite?.pid, "SIGKILL");
    killGroup(entry.fastify?.pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  // Drop the entry before any await: a request arriving mid-stop must see a
  // cold worktree and start a fresh generation, and the async cleanup below
  // must never delete that new generation's state (see onChildExit's comment).
  worktrees.delete(name);
  await removePidFile(name, { vitePid: entry.vite?.pid, fastifyPid: entry.fastify?.pid });
  await stopDashboard(entry).catch(() => {});
};

async function stopDashboard(entry: WorktreeEntry): Promise<void> {
  if (!entry.dashboardPort || !entry.browseEnv) return;
  try {
    await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
      env: entry.browseEnv,
      stdio: "ignore",
      timeout: 5000,
    });
  } catch (err) {
    log(`[${entry.name}] dashboard stop failed: ${(err as Error).message}`);
  }
}

function killGroup(pid: number | undefined, sig: NodeJS.Signals = "SIGTERM"): void {
  if (!pid) return;
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      /* gone */
    }
  }
}

// HTTP-level readiness probe. TCP listening is not enough — a process can
// accept connections before its request handlers are wired up.
async function waitForHttp(port: number, reqPath: string, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: reqPath, method: "GET", timeout: 1000 },
        (res) => {
          res.resume();
          resolve(true);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error(
    `${label} did not respond to HTTP GET ${reqPath} within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- HTTP proxy --------------------------------------------------------

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

proxy.on("error", (err: Error, _req, res) => {
  log(`proxy error: ${err.message}`);
  if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
    const r = res as http.ServerResponse;
    r.writeHead(502, { "content-type": "text/plain" });
    r.end(`Bad gateway: ${err.message}\n`);
  } else if (res) {
    try { (res as http.ServerResponse | Socket).end(); } catch { /* gone */ }
  }
});

function parseWorktreeName(reqPath: string): string | null {
  const m = reqPath.match(/^\/([^/?#]+)(?:[/?#]|$)/);
  return m ? m[1]! : null;
}

interface DiscoveredWorktree {
  name: string;
  running: boolean;
  entry?: WorktreeEntry;
}

async function discoverWorktrees(): Promise<DiscoveredWorktree[]> {
  const all = new Map<string, DiscoveredWorktree>();
  all.set("main", { name: "main", running: false });
  try {
    const entries = await fs.readdir(WORKTREES_ROOT, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) all.set(e.name, { name: e.name, running: false });
    }
  } catch {
    // No worktrees dir yet — fine.
  }
  for (const [name, entry] of worktrees) {
    const existing = all.get(name) ?? { name, running: false };
    all.set(name, { ...existing, running: entry.state === "ready", entry });
  }
  return Array.from(all.values()).sort((a, b) =>
    a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name),
  );
}

function escapeHtml(s: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(s).replace(/[&<>"']/g, (c) => replacements[c] ?? c);
}

async function renderIndex(): Promise<string> {
  const list = await discoverWorktrees();
  const rows = list.map((w) => {
    const status = w.entry?.state === "failed"
      ? `<span class="badge failed">failed · <a href="/${escapeHtml(w.name)}/">see error</a></span>`
      : w.running && w.entry?.lastActivity
        ? `<span class="badge running">running · idle ${Math.round((Date.now() - w.entry.lastActivity) / 1000)}s</span>`
        : `<span class="badge cold" title="will lazy-start on first request">cold</span>`;
    const dashLink = `<a href="/__router/dashboard/${escapeHtml(w.name)}" class="dash" target="_blank" rel="noopener" title="agent-browser dashboard for ${escapeHtml(w.name)} (starts the worktree if cold)">agent-browser ↗</a>`;
    const devLink = `<a href="/${escapeHtml(w.name)}/dev/" class="dash" title="agent-built visualizations &amp; markdown doc browser for ${escapeHtml(w.name)} (served from disk, no start)">dev ↗</a>`;
    const stopForm = w.running
      ? `<form method="POST" action="/__router/stop/${escapeHtml(w.name)}" class="stopForm">
           <button type="submit" title="Tell the router to stop ${escapeHtml(w.name)} now">stop</button>
         </form>`
      : "";
    return `
      <li>
        <a href="/${escapeHtml(w.name)}/" class="name">${escapeHtml(w.name)}</a>
        <span class="statuscell">${status}</span>
        ${dashLink}
        ${devLink}
        ${stopForm}
      </li>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>callback-box dev router</title>
<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAADCUlEQVR4nOyazWsTQRjG3+xOPpsQsa21pAcpeGipIAUp1YNi8aJ4EL17Ebz6J/RP8CoI4kkFxZN6qjcpIhTFYhFBPDRKbCMN+f7Yxic72+lm89F8707Z3yGZTWbmfZ53JzNDdli1WqUWpOKFve185m8xnypXCvs0WlhACUa94VP+EzPBaCzQqpqnqYHEVvrPZrqQKpMzCES90wuRqblI41dWA9nd0q/1f+lEkZxHZMp/Zvnk2ITP/GGdgeTP7I/3u+Rszl6dGJ8dE5dMlKRQD7hI4UHhbxg5UqjnQCoE87JhAOOepEIIrhnAnOPMX20bIBiyiRvAjEkSwmUzrFbOme+7ArIhnmGtJWmBeIadAkkLxLO8nOOHA/Fs9Lu0AQLxzHwdYlt4nfS/OvxE/cYLOW3eKFTmeCGrzYtyn/C4YEwPl22I1QbPlyfvuGihtVtyB052irc7byWSdWRcnjseQnjjoLln78VFGig5052x5NJ8h3vOl4XBGxgxCkmOa8BuXAN24xqwG9eA3bgG7KZuO72pzhgFFrPUW6jEa6/aNg0BEbeHEIw3fuZf0juKtaxo+kNyQYuf08PAVQ+WOox4ZBT0g048l98+p74xB6NmWUQw3NWvuvR2aeog0EGHRieDMWAj7ixkN64Bu3EN2I1rwG5cA3ZzvLbTaj5sFHJ1D/W1kPEQTQtmaDhYQncekfGW3uS0mgu3quRNnjZfaqHMvt4vwvRsScTVRYc7jEgmb7y55/rD79Q3jQGaGoNoJFjRpbfJV1cwGgRQIwRZkjds3FnIbo6BAVXix6wQr/i8OZIWiFemglKe9OBAvLIc85O0QLxyd+WS6pNyFEE2xNdmocXJJEkIl22cWrz16FOpECV58AVSr+9fILEO3DuvklQIwYaBG0uL12Z/kyRAKgTz8uFK/ODmFSk8QCSkikvr0eM3Hzcef9ac+XvAuMfIEbnnND/8vfpybWNnXCuFyBlgxsScs3pnpfErT5vj90/XPqzHi4l8pFQOkealEaOWsVPAWovVCvN9q1r/AQAA//+5h+wYAAAABklEQVQDANbzYY8DPoT1AAAAAElFTkSuQmCC">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 640px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; }
  p.sub { color: #666; margin-top: 0; }
  ul { list-style: none; padding: 0; }
  li { display: flex; align-items: center; gap: 0.6em; padding: 0.5em 0; border-bottom: 1px solid #eee; }
  a.name { font-weight: 600; text-decoration: none; color: #2255aa; font-family: ui-monospace, Menlo, monospace; min-width: 12em; }
  a.name:hover { text-decoration: underline; }
  .statuscell { flex: 0 0 11em; }
  .badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 4px; }
  .badge.running { background: #d8f0d8; color: #2a6b2a; }
  .badge.cold    { background: #ececec; color: #666; }
  .badge.failed  { background: #ffe1e1; color: #a22; }
  .badge.failed a { color: #a22; text-decoration: underline; }
  .dash { font-size: 0.8em; color: #2255aa; text-decoration: none; padding: 0.15em 0.5em; border: 1px solid #d0deef; border-radius: 4px; background: #f4f8ff; }
  .dash:hover { background: #e6f0ff; text-decoration: underline; }
  .stopForm { margin-left: auto; }
  .stopForm button { font-size: 0.75em; padding: 0.15em 0.6em; background: #fff; border: 1px solid #ddd; border-radius: 4px; color: #666; cursor: pointer; }
  .stopForm button:hover { background: #fee; border-color: #faa; color: #a22; }
  .help { margin-top: 2em; padding: 1em; background: #f7f7f7; border-radius: 6px; font-size: 0.9em; }
  .help h2 { margin: 0 0 0.4em; font-size: 1em; }
  .help code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
  footer { margin-top: 1em; font-size: 0.85em; color: #888; }
  footer a { color: #888; }
</style>
</head>
<body>
<h1>callback-box dev router</h1>
<p class="sub">Click a worktree to open it. Cold worktrees start on first request (~4s); running ones idle-shut-down after ${Math.round(IDLE_TIMEOUT_MS / 1000)}s. <strong>dev ↗</strong> opens that worktree's visualizations &amp; doc browser (served from disk, no start).</p>
<ul>${rows}</ul>

<div class="help">
  <h2>If something looks wedged</h2>
  <p>
    Run <code>bin/worktrees panic</code> from a terminal — this kills the
    router plus every child it knows about, wipes <code>~/.cache/callback-box</code>
    state, and frees port ${ROUTER_PORT}. Then start fresh with <code>pnpm dev</code>.
  </p>
  <p>
    Per-worktree logs are at <code>~/.cache/callback-box/logs/&lt;name&gt;.log</code>.
  </p>
  <h2>If the list is too long</h2>
  <p>
    Run <code>bin/worktrees sweep</code> to remove worktrees that are fully
    merged into main, clean, and have no active <code>claude</code> session —
    plus any orphan browse/log/pid state left behind by past cleanups.
    Add <code>--dry-run</code> to preview.
  </p>
</div>

<footer>
  <a href="/__router/status">status JSON</a>
</footer>
</body>
</html>
`;
}

/**
 * HTML error page shown when a worktree failed to start. Surfaces the
 * captured error message, the tail of each child's stderr, a link to
 * the per-worktree log, and a retry button that POSTs to
 * `/__router/retry/<name>`. Replaces the previous plain-text 502 so
 * the failure is actually debuggable from the browser.
 */
function renderFailedPage(name: string, err: CapturedError): string {
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const sinceMs = Date.now() - err.at;
  const viteSection = err.viteOutput.trim()
    ? `<h2>vite output (last ${err.viteOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.viteOutput)}</pre>`
    : `<h2>vite output</h2><p class="muted">(empty)</p>`;
  const fastifySection = err.fastifyOutput.trim()
    ? `<h2>fastify output (last ${err.fastifyOutput.length} bytes, stdout+stderr interleaved)</h2><pre>${escapeHtml(err.fastifyOutput)}</pre>`
    : `<h2>fastify output</h2><p class="muted">(empty)</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Worktree ${escapeHtml(name)} — failed to start</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 920px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; color: #a22; }
  h2 { font-size: 0.95em; margin: 1.5em 0 0.3em; color: #555; }
  p.sub { color: #666; margin-top: 0; }
  p.muted { color: #999; font-style: italic; }
  .err { margin: 1em 0; padding: 0.8em 1em; background: #fff5f5; border-left: 4px solid #c33; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 0.9em; white-space: pre-wrap; }
  pre { background: #f7f7f7; padding: 0.8em 1em; border-radius: 4px; overflow-x: auto; font-size: 0.8em; line-height: 1.4; max-height: 24em; }
  form { display: inline; }
  button { font: 14px/1 system-ui; padding: 0.5em 1em; background: #2255aa; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  button:hover { background: #1a4490; }
  a { color: #2255aa; }
  .actions { margin: 1.5em 0; display: flex; gap: 0.8em; align-items: center; }
  .meta { font-size: 0.85em; color: #888; }
  code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
</style>
</head>
<body>
<h1>Worktree <code>${escapeHtml(name)}</code> failed to start</h1>
<p class="sub">Phase: <code>${escapeHtml(err.phase)}</code> · <span class="meta">${Math.round(sinceMs / 1000)}s ago</span></p>

<div class="err">${escapeHtml(err.message)}</div>

<div class="actions">
  <form method="POST" action="/__router/retry/${escapeHtml(name)}">
    <button type="submit">Retry startup</button>
  </form>
  <a href="/">← back to router index</a>
</div>

${viteSection}
${fastifySection}

<h2>Per-worktree log</h2>
<p class="meta">Full output (both children, all attempts) lives at <code>${escapeHtml(logPath)}</code>.</p>

</body>
</html>
`;
}

// --- /<worktree>/dev/ space: agent-built views + manifest + doc browser ------
//
// Per-worktree, just like the box apps: /<name>/dev/ serves <name>'s checkout —
// its tracked dev/ directory (artifacts) and a markdown doc browser over its
// own .md files. Served straight from disk, so it never cold-starts the
// worktree's vite/fastify (you can read docs from a cold worktree).

function worktreeRoot(name: string): string {
  return name === "main" ? MAIN_ROOT : path.join(WORKTREES_ROOT, name);
}

function renderDevShell(title: string, breadcrumbs: string, body: string, extraCss = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · /dev</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<style>
  body { font: 15px/1.6 system-ui, sans-serif; max-width: 860px; margin: 0 auto; padding: 1.4em 1.2em 5em; color: #222; }
  nav.crumbs { font: 13px ui-monospace, Menlo, monospace; color: #888; margin-bottom: 1.6em; padding-bottom: 0.7em; border-bottom: 1px solid #eee; }
  nav.crumbs a { color: #2255aa; text-decoration: none; }
  nav.crumbs a:hover { text-decoration: underline; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.2em; margin-top: 1.6em; } h3 { font-size: 1.05em; }
  a { color: #2255aa; }
  code { background: #f3f3f3; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f7f7f7; padding: 0.9em 1em; border-radius: 6px; overflow-x: auto; line-height: 1.4; }
  pre code { background: none; padding: 0; }
  .hljs-comment, .hljs-quote { color: #6a737d; font-style: italic; }
  .hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-literal { color: #d73a49; }
  .hljs-type, .hljs-title.class_, .hljs-class .hljs-title { color: #6f42c1; }
  .hljs-string, .hljs-regexp, .hljs-attribute, .hljs-attr, .hljs-template-tag, .hljs-addition { color: #032f62; }
  .hljs-number, .hljs-meta { color: #005cc5; }
  .hljs-title, .hljs-title.function_, .hljs-section, .hljs-name { color: #6f42c1; }
  .hljs-variable, .hljs-property, .hljs-params { color: #24292e; }
  .hljs-symbol, .hljs-bullet, .hljs-deletion { color: #e36209; }
  .hljs-emphasis { font-style: italic; } .hljs-strong { font-weight: 700; }
  table { border-collapse: collapse; margin: 1em 0; font-size: 0.93em; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.7em; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; }
  blockquote { margin: 1em 0; padding: 0.3em 1em; border-left: 4px solid #d0deef; background: #f7faff; color: #444; }
  ul.dir { list-style: none; padding: 0; font: 14px ui-monospace, Menlo, monospace; }
  ul.dir li { padding: 0.35em 0; border-bottom: 1px solid #f0f0f0; display: flex; gap: 0.8em; }
  ul.dir a { text-decoration: none; min-width: 22em; }
  ul.dir a:hover { text-decoration: underline; }
  ul.dir .size { color: #999; }
  .cards { list-style: none; padding: 0; }
  .cards li { padding: 0.9em 1em; margin: 0.6em 0; border: 1px solid #e3e3e3; border-radius: 8px; background: #fbfbfb; }
  .cards a.title { font-weight: 600; font-size: 1.05em; text-decoration: none; }
  .cards .desc { color: #666; font-size: 0.9em; margin-top: 0.2em; }
  .empty { color: #888; font-style: italic; }
${extraCss}</style>
</head>
<body>
<nav class="crumbs">${breadcrumbs}</nav>
${body}
</body>
</html>`;
}

// Build "<base> / sub / file.md" breadcrumbs (base like "/main/dev"); every
// segment but the last links.
function devBreadcrumbs(base: string, rel: string): string {
  const parts = rel.split("/").filter(Boolean);
  const crumbs = [`<a href="/">router</a>`, `<a href="${base}/">${escapeHtml(base.replace(/^\//, ""))}</a>`];
  let acc = base;
  parts.forEach((part, i) => {
    acc += `/${part}`;
    crumbs.push(i === parts.length - 1 ? escapeHtml(part) : `<a href="${acc}/">${escapeHtml(part)}</a>`);
  });
  return crumbs.join(" / ");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Markdoc emits code fences as `<pre data-language="ts">escaped code</pre>`, or a
// plain `<pre>` when the fence has no language token. Re-run each block through
// highlight.js (already a dep) so code gets syntax colors. Un-tagged blocks
// default to `defaultLang` (ts — the language we write nearly everywhere, and
// what the doctests are even when their continue/cleanup fences omit it).
function highlightCodeBlocks(html: string, defaultLang: string): string {
  return html.replace(/<pre(?: data-language="([^"]*)")?>([\s\S]*?)<\/pre>/g, (_m, lang: string | undefined, body: string) => {
    const code = unescapeHtml(body);
    let language = lang && hljs.getLanguage(lang) ? lang : "";
    if (!language && defaultLang && hljs.getLanguage(defaultLang)) language = defaultLang;
    let inner: string;
    try {
      inner = language ? hljs.highlight(code, { language }).value : escapeHtml(code);
    } catch {
      inner = escapeHtml(code);
    }
    const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
    return `<pre class="hljs"><code${cls}>${inner}</code></pre>`;
  });
}

function renderMarkdownToHtml(src: string, defaultLang = "ts"): string {
  return highlightCodeBlocks(Markdoc.renderers.html(Markdoc.transform(Markdoc.parse(src))), defaultLang);
}

/**
 * The /dev/ manifest landing: the curated list of what you can view here —
 * built-in tools (the markdown doc browser) plus whatever artifacts the agent
 * has dropped in the tracked dev/ directory.
 */
async function renderDevManifest(name: string, base: string, devRoot: string): Promise<string> {
  const builtinHtml = `<li><a class="title" href="${base}/docs/">📄 Markdown doc browser</a>`
    + `<div class="desc">Browse and read every <code>.md</code> file in <code>${escapeHtml(name)}</code>, grouped by area, rendered to HTML. A reader that focuses only on docs.</div></li>`;

  let artifactsHtml: string;
  try {
    const dirents = (await fs.readdir(devRoot, { withFileTypes: true }))
      .filter((d) => !d.name.startsWith(".") && d.name !== "README.md")
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    if (dirents.length) {
      const rows = await Promise.all(dirents.map(async (d) => {
        const isDir = d.isDirectory();
        const href = `${base}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
        let size = "";
        if (!isDir) {
          try { size = formatSize((await fs.stat(path.join(devRoot, d.name))).size); } catch { /* skip */ }
        }
        return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
      }));
      artifactsHtml = `<ul class="dir">${rows.join("")}</ul>`;
    } else {
      artifactsHtml = `<p class="empty">No artifacts yet — the agent drops <code>.html</code> / <code>.md</code> / data files in <code>${escapeHtml(name)}/dev/</code> and they appear here.</p>`;
    }
  } catch {
    artifactsHtml = `<p class="empty">No <code>dev/</code> directory in <code>${escapeHtml(name)}</code> yet.</p>`;
  }

  const body = `<h1>${escapeHtml(name)} — /dev</h1>
<p class="sub" style="color:#666;margin-top:0">Visualizations &amp; views the agent built for you, from <code>${escapeHtml(name)}</code>'s tracked <code>dev/</code> directory.</p>
<h2>Built-in tools</h2>
<ul class="cards">${builtinHtml}</ul>
<h2>Artifacts in <code>dev/</code></h2>
${artifactsHtml}`;
  return renderDevShell(`${name} · dev`, devBreadcrumbs(base, ""), body);
}

// --- markdown doc browser (/dev/docs) ---------------------------------------

async function listRepoMarkdown(repoRoot: string): Promise<string[]> {
  try {
    // --cached (tracked) + --others (untracked) so in-progress, never-committed
    // docs show up too; --exclude-standard keeps .gitignored trees out (e.g.
    // node_modules, docs/generated/).
    const { stdout } = await execa(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "*.md", "**/*.md"],
      { cwd: repoRoot },
    );
    return Array.from(new Set(stdout.split("\n").filter(Boolean))).sort();
  } catch {
    return [];
  }
}

// Last-commit unix time per .md file (one history walk; first occurrence wins,
// since `git log` is newest-first). Filesystem mtime is useless in a worktree —
// every file shares the clone time — so we use git for "recently edited".
async function mdLastModified(repoRoot: string, files: string[]): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  try {
    const { stdout } = await execa("git", ["log", "--format=%ct", "--name-only", "--", "*.md", "**/*.md"], { cwd: repoRoot });
    let cur = 0;
    for (const line of stdout.split("\n")) {
      if (line === "") continue;
      if (/^\d+$/.test(line)) { cur = Number(line); continue; }
      if (!times.has(line)) times.set(line, cur);
    }
  } catch { /* leave empty */ }
  // Untracked (never-committed) files have no git time. Their filesystem mtime
  // IS meaningful here — they were created after the worktree clone, not shared
  // at clone time like tracked files — so fall back to it, which floats
  // in-progress docs to the top of the "recent" sort.
  await Promise.all(
    files
      .filter((f) => !times.has(f))
      .map(async (f) => {
        try {
          const st = await fs.stat(path.resolve(repoRoot, f));
          times.set(f, Math.floor(st.mtimeMs / 1000));
        } catch { /* unreadable — skip */ }
      }),
  );
  return times;
}

// A top-level area with more than this many .md files is split into a second
// level (e.g. callback-box/ → callback-box/docs, callback-box/test, …). Smaller
// areas stay flat — the flatness is nice when it fits.
const DOC_TWO_LEVEL_THRESHOLD = 60;

function docHref(base: string, f: string, sort: string): string {
  const q = sort === "recent" ? "?sort=recent" : "";
  return `${base}/docs/${f.split("/").map(encodeURIComponent).join("/")}${q}`;
}

function docGroupKey(f: string, bigTops: Set<string>): string {
  const [top, ...rest] = f.split("/");
  if (top === undefined || rest.length === 0) return "(root)";
  const [second] = rest;
  if (second !== undefined && rest.length >= 2 && bigTops.has(top)) return `${top}/${second}`;
  return top;
}

/**
 * The doc-browser sidebar. Two views, toggled by `sort`:
 *  - "path" (default): <details> groups by area; big areas go two levels deep.
 *  - "recent": one flat list, most-recently-committed first, dated.
 * The group/list item for the current file is marked active and expanded.
 */
function renderDocSidebar(base: string, files: string[], currentRel: string, sort: string, times: Map<string, number>): string {
  const indexHref = (s: string) => `${base}/docs/${s === "recent" ? "?sort=recent" : ""}`;
  const curHref = (s: string) => (currentRel ? docHref(base, currentRel, s) : indexHref(s));
  const toggle = `<div class="docsort">`
    + `<a class="${sort !== "recent" ? "on" : ""}" href="${curHref("path")}">by path</a> · `
    + `<a class="${sort === "recent" ? "on" : ""}" href="${curHref("recent")}">recently edited</a></div>`;

  let listHtml: string;
  if (sort === "recent") {
    const sorted = [...files].sort((a, b) => (times.get(b) ?? 0) - (times.get(a) ?? 0));
    listHtml = `<ul class="flat">${sorted.map((f) => {
      const active = f === currentRel ? ' class="active"' : "";
      const t = times.get(f);
      const date = t ? new Date(t * 1000).toISOString().slice(0, 10) : "";
      return `<li${active}><a href="${docHref(base, f, "recent")}" title="${escapeHtml(f)}">${escapeHtml(f)}</a><span class="date">${date}</span></li>`;
    }).join("")}</ul>`;
  } else {
    const counts = new Map<string, number>();
    for (const f of files) {
      const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : "(root)";
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    const bigTops = new Set([...counts].filter(([, n]) => n > DOC_TWO_LEVEL_THRESHOLD).map(([k]) => k));
    const groups = new Map<string, string[]>();
    for (const f of files) {
      const key = docGroupKey(f, bigTops);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
    }
    listHtml = Array.from(groups.entries()).map(([group, gfiles]) => {
      const hasCurrent = gfiles.includes(currentRel);
      const items = gfiles.map((f) => {
        const label = f.startsWith(`${group}/`) ? f.slice(group.length + 1) : f;
        const active = f === currentRel ? ' class="active"' : "";
        return `<li${active}><a href="${docHref(base, f, "path")}">${escapeHtml(label)}</a></li>`;
      }).join("");
      return `<details${hasCurrent ? " open" : ""}><summary>${escapeHtml(group)} <span class="n">${gfiles.length}</span></summary><ul>${items}</ul></details>`;
    }).join("");
  }
  return `<aside class="docnav"><div class="docnav-head">${files.length} markdown files</div>${toggle}${listHtml}</aside>`;
}

const DOC_BROWSER_CSS = `
  body { max-width: none; padding: 0; }
  nav.crumbs { padding: 0.7em 1.2em; margin: 0; }
  .docwrap { display: flex; align-items: flex-start; gap: 0; }
  aside.docnav { flex: 0 0 20em; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; border-right: 1px solid #eee; padding: 0.5em 0.8em 3em; font: 13px ui-monospace, Menlo, monospace; }
  .docnav-head { color: #888; font-size: 0.85em; margin: 0.4em 0 0.4em; }
  .docsort { font-size: 0.85em; margin: 0 0 0.9em; }
  .docsort a { text-decoration: none; color: #999; }
  .docsort a.on { color: #222; font-weight: 700; }
  aside.docnav details { margin-bottom: 0.3em; }
  aside.docnav summary { cursor: pointer; color: #444; padding: 0.2em 0; }
  aside.docnav summary .n { color: #aaa; font-size: 0.85em; }
  aside.docnav ul { list-style: none; padding: 0 0 0.4em 0.9em; margin: 0.2em 0; }
  aside.docnav li { padding: 0.12em 0; }
  aside.docnav li a { text-decoration: none; color: #2255aa; }
  aside.docnav li.active a { font-weight: 700; color: #a2380a; }
  aside.docnav ul.flat { padding-left: 0; }
  aside.docnav ul.flat li { display: flex; justify-content: space-between; gap: 0.6em; align-items: baseline; }
  aside.docnav ul.flat li a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  aside.docnav ul.flat .date { color: #aaa; font-size: 0.8em; white-space: nowrap; }
  main.doccontent { flex: 1 1 auto; min-width: 0; max-width: 820px; padding: 0.5em 2em 5em; }
  main.doccontent .placeholder { color: #888; margin-top: 3em; }
  .qo-hint { position: fixed; bottom: 0.7em; right: 1em; font: 11px ui-monospace, monospace; color: #bbb; user-select: none; }
  .qo-hint kbd { background: #f0f0f0; border: 1px solid #ddd; border-bottom-width: 2px; border-radius: 4px; padding: 0.05em 0.35em; color: #666; }
  .qo-backdrop { position: fixed; inset: 0; background: rgba(20,20,25,0.28); display: flex; align-items: flex-start; justify-content: center; z-index: 1000; }
  .qo-backdrop[hidden] { display: none; }
  .qo-panel { margin-top: 12vh; width: min(620px, 92vw); background: #fff; border: 1px solid #ccc; border-radius: 10px; box-shadow: 0 12px 48px rgba(0,0,0,0.25); overflow: hidden; }
  .qo-panel input { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid #eee; padding: 0.8em 1em; font: 15px system-ui, sans-serif; outline: none; }
  .qo-results { list-style: none; margin: 0; padding: 0.3em 0; max-height: 52vh; overflow-y: auto; font: 13px ui-monospace, Menlo, monospace; }
  .qo-results li { padding: 0.35em 1em; cursor: pointer; display: flex; align-items: baseline; gap: 0.55em; white-space: nowrap; overflow: hidden; }
  .qo-results li.sel { background: #eef3fb; }
  .qo-results .qo-name { color: #222; text-overflow: ellipsis; overflow: hidden; }
  .qo-results li.sel .qo-name { color: #a2380a; }
  .qo-results .qo-dir { color: #aaa; font-size: 0.86em; text-overflow: ellipsis; overflow: hidden; }
  .qo-results mark { background: none; color: #2255aa; font-weight: 700; }
  .qo-results li.sel mark { color: #a2380a; }
  .qo-empty { padding: 0.7em 1em; color: #999; font: 13px ui-monospace, monospace; }
`;

// VS-Code-style Cmd-P / Ctrl-P quick-open over the full doc list. Self-contained
// vanilla overlay: the file list ships as JSON, a compact subsequence fuzzy
// scorer ranks matches (basename + contiguous runs favoured), keyboard-first.
// `files` are already collected server-side; `base` is like "/main/dev".
function renderDocQuickOpen(base: string, files: string[]): string {
  // Serialize for a <script> context: neutralize "</script>" and JS line
  // separators so the array survives inline embedding.
  const filesJson = JSON.stringify(files)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const baseJson = JSON.stringify(base).replace(/</g, "\\u003c");
  return `<div class="qo-hint"><kbd id="qo-hint-key">Ctrl-P</kbd> quick open</div>
<div class="qo-backdrop" id="qo" hidden role="dialog" aria-modal="true" aria-label="Quick open document">
  <div class="qo-panel">
    <input id="qo-input" type="text" placeholder="Go to doc…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="qo-results" aria-autocomplete="list">
    <ul class="qo-results" id="qo-results" role="listbox"></ul>
  </div>
</div>
<script>
(function () {
  var FILES = ${filesJson};
  var BASE = ${baseJson};
  var LIMIT = 50;
  var backdrop = document.getElementById("qo");
  var input = document.getElementById("qo-input");
  var list = document.getElementById("qo-results");
  var matches = [];
  var sel = 0;
  var lastFocus = null;
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  var hintKey = document.getElementById("qo-hint-key");
  if (isMac && hintKey) hintKey.textContent = "⌘P";

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Greedy leftmost subsequence match with positional scoring. Returns
  // {score, pos:[indices]} or null when q is not a subsequence of target.
  function score(q, target) {
    if (!q) return { score: 0, pos: [] };
    var t = target.toLowerCase();
    var ql = q.toLowerCase();
    var slash = target.lastIndexOf("/");
    var pos = [];
    var total = 0;
    var ti = 0;
    var prev = -2;
    for (var qi = 0; qi < ql.length; qi++) {
      var found = -1;
      for (var j = ti; j < t.length; j++) { if (t[j] === ql[qi]) { found = j; break; } }
      if (found === -1) return null;
      var s = 1;
      if (found === prev + 1) s += 5;                                  // contiguous run
      var pc = found > 0 ? t[found - 1] : "/";
      if (pc === "/" || pc === "-" || pc === "_" || pc === "." || pc === " ") s += 3; // word start
      if (found > slash) s += 4;                                       // inside basename
      if (found === slash + 1) s += 3;                                 // at basename start
      total += s;
      pos.push(found);
      prev = found;
      ti = found + 1;
    }
    total -= target.length * 0.02;                                     // mild shortness bias
    return { score: total, pos: pos };
  }

  function compute(q) {
    var out = [];
    for (var i = 0; i < FILES.length; i++) {
      var r = score(q, FILES[i]);
      if (r) out.push({ file: FILES[i], score: r.score, pos: r.pos, i: i });
    }
    out.sort(function (a, b) { return b.score - a.score || a.file.localeCompare(b.file); });
    return out.slice(0, LIMIT);
  }

  // Render one path with matched chars marked, basename vs dir split visually.
  function markup(file, pos) {
    var set = {};
    for (var k = 0; k < pos.length; k++) set[pos[k]] = true;
    var slash = file.lastIndexOf("/");
    var dir = slash >= 0 ? file.slice(0, slash + 1) : "";
    var html = "";
    for (var c = 0; c < file.length; c++) {
      var ch = esc(file[c]);
      html += set[c] ? "<mark>" + ch + "</mark>" : ch;
      if (c === slash) html = '<span class="qo-dir">' + html + '</span><span class="qo-name">';
    }
    if (slash >= 0) html += "</span>";
    else html = '<span class="qo-name">' + html + "</span>";
    return html;
  }

  function render() {
    if (!matches.length) {
      list.innerHTML = '<li class="qo-empty" role="option">No matching docs</li>';
      return;
    }
    var h = "";
    for (var i = 0; i < matches.length; i++) {
      h += '<li role="option" data-i="' + i + '"' + (i === sel ? ' class="sel" aria-selected="true"' : "") + ">" + markup(matches[i].file, matches[i].pos) + "</li>";
    }
    list.innerHTML = h;
    var selEl = list.querySelector("li.sel");
    if (selEl) selEl.scrollIntoView({ block: "nearest" });
  }

  function refresh() {
    matches = compute(input.value.trim());
    sel = 0;
    render();
  }

  function open() {
    if (!backdrop.hidden) return;
    lastFocus = document.activeElement;
    backdrop.hidden = false;
    input.value = "";
    refresh();
    input.focus();
  }

  function close() {
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function go() {
    var m = matches[sel];
    if (!m) return;
    var url = BASE + "/docs/" + m.file.split("/").map(encodeURIComponent).join("/");
    location.href = url;
  }

  document.addEventListener("keydown", function (e) {
    // Cmd-P (mac) / Ctrl-P — intercept the browser print shortcut.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === "p" || e.key === "P")) {
      e.preventDefault();
      if (backdrop.hidden) open(); else close();
      return;
    }
    if (backdrop.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (matches.length) { sel = (sel + 1) % matches.length; render(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (matches.length) { sel = (sel - 1 + matches.length) % matches.length; render(); } }
    else if (e.key === "Enter") { e.preventDefault(); go(); }
    else if (e.key === "Tab") { e.preventDefault(); } // trap focus in the dialog
  });

  input.addEventListener("input", refresh);
  list.addEventListener("mousemove", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { var i = Number(li.getAttribute("data-i")); if (i !== sel) { sel = i; render(); } }
  });
  list.addEventListener("click", function (e) {
    var li = e.target.closest("li[data-i]");
    if (li) { sel = Number(li.getAttribute("data-i")); go(); }
  });
  backdrop.addEventListener("mousedown", function (e) { if (e.target === backdrop) close(); });
})();
</script>`;
}

async function serveDocBrowser(base: string, repoRoot: string, rel: string, sort: string, res: http.ServerResponse): Promise<void> {
  // rel is the part after "/docs", e.g. "" | "/" | "/callback-box/CLAUDE.md"
  const fileRel = rel.replace(/^\//, "");
  const files = await listRepoMarkdown(repoRoot);
  const times = sort === "recent" ? await mdLastModified(repoRoot, files) : new Map<string, number>();

  let contentHtml: string;
  let title = "doc browser";
  if (fileRel) {
    const resolved = path.resolve(repoRoot, fileRel);
    if (!resolved.startsWith(repoRoot + path.sep) || !resolved.endsWith(".md")) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden\n");
      return;
    }
    try {
      const src = await fs.readFile(resolved, "utf8");
      contentHtml = `<p style="color:#888;font:12px ui-monospace,monospace;margin-top:0">${escapeHtml(fileRel)}</p>${renderMarkdownToHtml(src)}`;
      title = path.basename(resolved);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`not found: ${fileRel}\n`);
      return;
    }
  } else {
    contentHtml = `<div class="placeholder"><h1>Markdown doc browser</h1><p>${files.length} <code>.md</code> files. Pick one from the left.</p></div>`;
  }

  const body = `<div class="docwrap">${renderDocSidebar(base, files, fileRel, sort, times)}<main class="doccontent">${contentHtml}</main></div>${renderDocQuickOpen(base, files)}`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderDevShell(title, devBreadcrumbs(base, fileRel ? `docs/${fileRel}` : "docs"), body, DOC_BROWSER_CSS));
}

// --- static artifacts from the worktree's tracked dev/ directory -------------

async function serveDevArtifact(base: string, devRoot: string, rel: string, pathOnly: string, res: http.ServerResponse): Promise<void> {
  const resolved = path.resolve(devRoot, `.${rel || "/"}`);
  if (resolved !== devRoot && !resolved.startsWith(devRoot + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden\n");
    return;
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end(`not found in dev/: ${rel}\n`);
    return;
  }
  if (stat.isDirectory()) {
    if (!pathOnly.endsWith("/")) {
      res.writeHead(301, { location: `${base}${rel}/` });
      res.end();
      return;
    }
    const dirents = (await fs.readdir(resolved, { withFileTypes: true }))
      .filter((d) => !d.name.startsWith("."))
      .sort((a, b) =>
        a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
      );
    const dirBase = `${base}${rel}`.replace(/\/$/, "");
    const rows = await Promise.all(dirents.map(async (d) => {
      const isDir = d.isDirectory();
      const href = `${dirBase}/${encodeURIComponent(d.name)}${isDir ? "/" : ""}`;
      let size = "";
      if (!isDir) {
        try { size = formatSize((await fs.stat(path.join(resolved, d.name))).size); } catch { /* skip */ }
      }
      return `<li><a href="${href}">${escapeHtml(d.name)}${isDir ? "/" : ""}</a><span class="size">${size}</span></li>`;
    }));
    const heading = escapeHtml(rel || "/");
    const inner = dirents.length
      ? `<h1>${heading}</h1><ul class="dir">${rows.join("")}</ul>`
      : `<h1>${heading}</h1><p class="empty">empty</p>`;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDevShell(rel || "dev", devBreadcrumbs(base, rel.replace(/\/$/, "")), inner));
    return;
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".md") {
    const src = await fs.readFile(resolved, "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDevShell(path.basename(resolved), devBreadcrumbs(base, rel), renderMarkdownToHtml(src)));
    return;
  }
  const buf = await fs.readFile(resolved);
  res.writeHead(200, {
    "content-type": DEV_CONTENT_TYPES[ext] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  res.end(buf);
}

/** Dispatch everything under /<name>/dev/. `rest` is the URL after /<name>. */
async function serveDev(name: string, rest: string, res: http.ServerResponse): Promise<void> {
  // The /dev/ space is live working material — never let the browser cache it.
  // Set here so every response below (manifest, doc browser, .md, dir index,
  // static artifacts) inherits it; nothing overrides cache-control to anything
  // weaker. Edits show on reload with no server restart.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const base = `/${name}/dev`;
  const repoRoot = worktreeRoot(name);
  const devRoot = path.join(repoRoot, "dev");
  const [pathOnly = ""] = rest.split("?");
  const rel = decodeURIComponent(pathOnly.slice("/dev".length)); // "" | "/" | "/docs/..." | "/foo.html"

  if (rel === "" || rel === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderDevManifest(name, base, devRoot));
    return;
  }
  if (rel === "/docs") {
    res.writeHead(301, { location: `${base}/docs/` });
    res.end();
    return;
  }
  if (rel === "/docs/" || rel.startsWith("/docs/")) {
    const query = rest.includes("?") ? rest.slice(rest.indexOf("?") + 1) : "";
    const sort = new URLSearchParams(query).get("sort") === "recent" ? "recent" : "path";
    await serveDocBrowser(base, repoRoot, rel.slice("/docs".length), sort, res);
    return;
  }
  await serveDevArtifact(base, devRoot, rel, pathOnly, res);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/__router/status" || url === "/__router/status/") {
    res.writeHead(200, { "content-type": "application/json" });
    // Disk-discovery first so cold worktrees (not yet hit by a request)
    // still appear in the status response — otherwise the JSON looks
    // empty when a freshly-created worktree exists but hasn't been
    // warmed yet, which is misleading next to the homepage which does
    // list it.
    const discovered = await discoverWorktrees();
    const state: Record<string, unknown> = {};
    for (const w of discovered) {
      const entry = worktrees.get(w.name);
      if (entry) {
        state[w.name] = {
          state: entry.state,
          frontendPort: entry.frontendPort,
          backendPort: entry.backendPort,
          dashboardPort: entry.dashboardPort,
          dashboardUrl: entry.dashboardUrl,
          vitePid: entry.vite?.pid,
          fastifyPid: entry.fastify?.pid,
          socketDir: entry.socketDir,
          profileDir: entry.profileDir,
          startedAt: entry.startedAt,
          lastActivity: entry.lastActivity,
          idleMs: entry.lastActivity ? Date.now() - entry.lastActivity : null,
        };
      } else {
        state[w.name] = { state: "cold" };
      }
    }
    res.end(
      JSON.stringify(
        {
          routerPort: ROUTER_PORT,
          routerPid: process.pid,
          idleTimeoutMs: IDLE_TIMEOUT_MS,
          worktrees: state,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (url.startsWith("/__router/retry/")) {
    const name = url.slice("/__router/retry/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return;
    }
    // POST-only — a GET probe (e.g. a curl with no -X) shouldn't have a
    // side effect. The failure page's retry button POSTs.
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("retry requires POST\n");
      return;
    }
    // Clear any failed-state entry so ensureRunning will spawn a fresh
    // attempt rather than re-throwing the cached error.
    const existing = worktrees.get(name);
    if (existing?.state === "failed") {
      worktrees.delete(name);
    }
    res.writeHead(303, { location: `/${name}/` });
    res.end();
    return;
  }

  if (url.startsWith("/__router/stop/")) {
    const name = url.slice("/__router/stop/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return;
    }
    // POST-only — same reasoning as retry: a GET (curl without -X, a link
    // prefetcher, a crawler) must not kill a running worktree.
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("stop requires POST\n");
      return;
    }
    await stopWorktree(name);
    const wantsHtml = (req.headers.accept ?? "").includes("text/html");
    if (wantsHtml) {
      res.writeHead(303, { location: "/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`stopped ${name}\n`);
    return;
  }

  if (url.startsWith("/__router/dashboard/")) {
    const name = url.slice("/__router/dashboard/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return;
    }
    let entry: WorktreeEntry;
    try {
      entry = await ensureRunning(name);
    } catch (err) {
      const status = (err as StatusError).statusCode ?? 502;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(`Failed to start worktree ${name}: ${(err as Error).message}\n`);
      return;
    }
    if (!entry.dashboardUrl) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Worktree ${name} is running but its dashboard failed to start. See logs at ~/.cache/callback-box/logs/${name}.log\n`);
      return;
    }
    res.writeHead(302, { location: entry.dashboardUrl });
    res.end();
    return;
  }

  if (url === "/" || url === "") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(await renderIndex());
    return;
  }

  if (url === "/favicon.png" || url === "/favicon.ico") {
    try {
      const buf = await fs.readFile(path.join(REPO_ROOT, "bin", "assets", "favicon.png"));
      res.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400",
      });
      res.end(buf);
    } catch (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end(`favicon not found: ${(err as Error).message}\n`);
    }
    return;
  }

  // Bare /dev → the main checkout's dev space (it's per-worktree; default main).
  if (url.split("?")[0] === "/dev" || url.split("?")[0] === "/dev/") {
    res.writeHead(301, { location: "/main/dev/" });
    res.end();
    return;
  }

  const name = parseWorktreeName(url);
  if (!name) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no worktree in path\n");
    return;
  }

  if (url === `/${name}`) {
    res.writeHead(301, { location: `/${name}/` });
    res.end();
    return;
  }

  // /<name>/dev/... — the worktree's dev space (artifacts + doc browser),
  // served straight from disk so it never cold-starts the worktree.
  const afterName = url.slice(`/${name}`.length);
  if (afterName.split("?")[0] === "/dev") {
    res.writeHead(301, { location: `/${name}/dev/` });
    res.end();
    return;
  }
  if (afterName.startsWith("/dev/")) {
    await serveDev(name, afterName, res);
    return;
  }

  try {
    await ensureRunning(name);
  } catch (err) {
    const status = (err as StatusError).statusCode ?? 502;
    // If we have a captured failure for this worktree, render the rich
    // HTML error page (stderr tail + retry button). Otherwise fall back
    // to plain text (e.g. 404 for unknown worktree name).
    const failed = worktrees.get(name);
    if (failed?.state === "failed" && failed.lastError) {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(renderFailedPage(name, failed.lastError));
      return;
    }
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(`Failed to start worktree ${name}: ${(err as Error).message}\n`);
    return;
  }

  await proxyWithRetry(req, res, name, 5);
});

// WebSocket upgrades never cold-start a worktree. Clients auto-reconnect on
// timers (tRPC's wsLink retries forever, first attempt with zero delay), so
// treating an upgrade as user activity would resurrect an idle-shutdown
// worktree from any abandoned background tab, forever. Refusal is cheap for
// the client (it just backs off and retries); the worktree comes back when a
// real HTTP request arrives — a page load, an API call, or Vite's HMR ping
// (sent only while the tab is visible), after which the next retry connects.
const refusedUpgradeLogAt = new Map<string, number>();
server.on("upgrade", async (req, socket, head) => {
  const reqUrl = req.url || "/";
  const name = parseWorktreeName(reqUrl);
  if (!name) {
    socket.destroy();
    return;
  }
  let entry = worktrees.get(name);
  if (entry?.startPromise) {
    // A cold start is already underway (triggered by an HTTP request) — let
    // the socket wait for it rather than refusing and forcing a retry cycle.
    try {
      entry = await entry.startPromise;
    } catch (err) {
      log(`[${name}] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
      return;
    }
  }
  if (entry?.state !== "ready") {
    const last = refusedUpgradeLogAt.get(name) ?? 0;
    if (Date.now() - last > 60_000) {
      refusedUpgradeLogAt.set(name, Date.now());
      log(`[${name}] refusing WS upgrade while not running (logged at most once/min)`);
    }
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  touch(entry);
  const target = `http://127.0.0.1:${entry.frontendPort}`;
  proxy.ws(req, socket, head, { target }, (err: Error | undefined) => {
    if (err) {
      log(`[${entry.name}] ws proxy error: ${err.message}`);
      try { socket.destroy(); } catch { /* already gone */ }
    }
  });
});

// Proxying consumes the request's body stream, so a naive retry after
// ECONNREFUSED re-sends the request with no body — the upstream then waits
// forever for JSON that never arrives (this wedged chat sends that raced an
// idle shutdown). Requests with a small known body are buffered up front and
// each attempt replays the buffer; bodies that are large or of unknown length
// get exactly one attempt.
const MAX_REPLAY_BODY_BYTES = 1024 * 1024;

/** Body bytes to buffer for replay, or null when the request isn't replayable. */
function replayableBodyLength(req: http.IncomingMessage): number | null {
  if (req.method === "GET" || req.method === "HEAD") return 0;
  const len = Number(req.headers["content-length"] ?? Number.NaN);
  return Number.isFinite(len) && len <= MAX_REPLAY_BODY_BYTES ? len : null;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** One proxy attempt. Resolves with the proxy error, or undefined on success. */
function proxyOnce(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  { entry, body }: { entry: WorktreeEntry; body: Buffer | null },
): Promise<(Error & { code?: string }) | undefined> {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${entry.frontendPort}`;
    // The proxy callback fires only on error; success is the response closing.
    res.on("close", () => resolve(undefined));
    const options = body === null
      ? { target }
      : { target, buffer: Readable.from(body) };
    proxy.web(req, res, options, (err: Error & { code?: string } | undefined) => resolve(err));
  });
}

async function proxyWithRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  name: string,
  retriesLeft: number,
): Promise<void> {
  const bodyLength = replayableBodyLength(req);
  const body = bodyLength === null ? null : await readBody(req);
  for (;;) {
    let entry: WorktreeEntry;
    try {
      // Re-resolve every attempt: after a kill/restart race the worktree's
      // new generation listens on different ports, so retrying the original
      // target would hammer a dead port. ensureRunning also restarts a
      // worktree that died between request arrival and proxying — the HTTP
      // request already established user intent.
      entry = await ensureRunning(name);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead((err as StatusError).statusCode ?? 502, { "content-type": "text/plain" });
        res.end(`Failed to start worktree ${name}: ${(err as Error).message}\n`);
      }
      return;
    }
    const err = await proxyOnce(req, res, { entry, body });
    if (!err) return;
    // ECONNREFUSED: nothing listening (cold port). ECONNRESET/EPIPE: the
    // process died with the socket mid-handshake (e.g. a kill racing the
    // request). All three happen before any response, so a buffered body can
    // be replayed safely; headersSent guards the mid-response variants.
    const transientCodes = ["ECONNREFUSED", "ECONNRESET", "EPIPE"];
    const retryable = transientCodes.includes(err.code ?? "") && body !== null && !res.headersSent;
    if (retryable && retriesLeft > 0) {
      retriesLeft--;
      log(`[${name}] upstream not ready, retry (${retriesLeft} left)`);
      await sleep(600);
      continue;
    }
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Upstream unavailable: ${err.message}\n`);
    } else {
      try { res.end(); } catch { /* already ended */ }
    }
    return;
  }
}

// --- Router PID file ---------------------------------------------------

async function acquireRouterPidFile(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    const existing = await fs.readFile(ROUTER_PID_FILE, "utf8");
    const pid = Number(existing.trim());
    if (pid && pidAlive(pid)) {
      throw new Error(
        `Another router is already running (pid ${pid}). Run \`bin/worktrees panic\` to clear.`,
      );
    }
  } catch (e) {
    const err = e as ErrnoError;
    if (err.code !== "ENOENT") {
      if (err.message.startsWith("Another router")) throw err;
      // Otherwise the file is malformed; overwrite it.
    }
  }
  await fs.writeFile(ROUTER_PID_FILE, String(process.pid));
}

// --- Shutdown ----------------------------------------------------------

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down: ${reason}`);
  for (const entry of worktrees.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    killGroup(entry.vite?.pid);
    killGroup(entry.fastify?.pid);
  }
  setTimeout(() => {
    for (const entry of worktrees.values()) {
      killGroup(entry.vite?.pid, "SIGKILL");
      killGroup(entry.fastify?.pid, "SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
  await sleep(500);
  for (const name of worktrees.keys()) {
    await removePidFile(name);
  }
  await fs.unlink(ROUTER_PID_FILE).catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), KILL_GRACE_MS + 500).unref();
}

process.on("SIGINT", () => { shutdown("SIGINT"); });
process.on("SIGTERM", () => { shutdown("SIGTERM"); });
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  shutdown("uncaughtException");
});

function log(msg: string): void {
  console.log(`[router ${new Date().toISOString()}] ${msg}`);
}

// --- Terminal tab title -----------------------------------------------

function setTabTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function updateTabTitle(): void {
  const running = [...worktrees.values()].filter((e) => e.state === "ready");
  let title = `⚡ cb router :${ROUTER_PORT}`;
  if (running.length === 1) {
    title += ` · ${running[0]!.name}`;
  } else if (running.length > 1) {
    title += ` · ${running.length} worktrees`;
  }
  setTabTitle(title);
}

// Hook the state-transition helpers to keep the tab title fresh.
const _origTouch = touch;
touch = (entry: WorktreeEntry) => { _origTouch(entry); updateTabTitle(); };
const _origStop = stopWorktree;
stopWorktree = async (name: string) => { await _origStop(name); updateTabTitle(); };
const _origOnExit = onChildExit;
onChildExit = (name: string, exited: WorktreeEntry) => { _origOnExit(name, exited); updateTabTitle(); };

// --- Boot --------------------------------------------------------------

(async () => {
  await acquireRouterPidFile();
  // Two-stage sweep. sweepStaleChildren clears THIS state dir's pidfile-tracked
  // children (current generation + dashboard daemons). reclaimOrphans then
  // pattern-matches what pidfiles can't see: leaked older generations and
  // agent-browsers orphaned by a previous router's crash/restart. It's
  // session-safe (skips vite/fastify still parented by a live router — e.g. an
  // isolated test router — and agent-browsers owned by an active claude
  // session), so it's safe to run unconditionally on every startup.
  await sweepStaleChildren();
  try {
    const { killed, spared } = await reclaimOrphans({ aggressive: false, log });
    if (killed.length > 0 || spared.length > 0) {
      log(`startup reclaim: killed ${killed.length} orphan(s), spared ${spared.length}`);
    }
  } catch (err) {
    log(`startup reclaim failed (continuing): ${(err as Error).message}`);
  }
  server.listen(ROUTER_PORT, () => {
    log(`listening on http://localhost:${ROUTER_PORT}  (pid ${process.pid})`);
    log(`open http://localhost:${ROUTER_PORT}/main/ to dev the main checkout (root: ${MAIN_ROOT})`);
    log(`idle timeout: ${IDLE_TIMEOUT_MS}ms`);
    updateTabTitle();
  });
})().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
