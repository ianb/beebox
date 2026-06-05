#!/usr/bin/env node
// Dev router for the callback-mono monorepo.
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
//   - Each spawned child is recorded in ~/.cache/callback-mono/pids/<name>.json
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
import type { Socket } from "node:net";
import { execa, type ResultPromise } from "execa";
import getPort from "get-port";
import httpProxy from "http-proxy-3";

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
const MAIN_ROOT = process.env.CALLBACK_MAIN_ROOT || path.join(os.homedir(), "src", "callback-mono");
const WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees");
const BOXES_ROOT = path.join(os.homedir(), "src", "box-worktrees");
const STATE_DIR = path.join(os.homedir(), ".cache", "callback-mono");
const LOG_DIR = path.join(STATE_DIR, "logs");
const PID_DIR = path.join(STATE_DIR, "pids");
const BROWSE_DIR = path.join(STATE_DIR, "browse");
const ROUTER_PID_FILE = path.join(STATE_DIR, "router.pid");

const AGENT_BROWSER_BIN = path.join(REPO_ROOT, "node_modules", "agent-browser", "bin", "agent-browser.js");

function browseDirsFor(name: string): { base: string; socketDir: string; profileDir: string } {
  const base = path.join(BROWSE_DIR, name);
  return { base, socketDir: path.join(base, "socket"), profileDir: path.join(base, "profile") };
}

const IDLE_TIMEOUT_MS = Number(process.env.ROUTER_IDLE_MS) || 5 * 60 * 1000;
const KILL_GRACE_MS = 2000;

const MAIN_BOX_DEFAULTS = [
  path.join(os.homedir(), "src", "boxes", "hearthside"),
  path.join(os.homedir(), "src", "boxes", "test1"),
  path.join(os.homedir(), "src", "boxes", "hearth-test"),
  path.join(os.homedir(), "src", "boxes", "studio"),
  path.join(os.homedir(), "src", "boxes", "meta-cb"),
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

async function removePidFile(name: string): Promise<void> {
  try {
    await fs.unlink(path.join(PID_DIR, `${name}.json`));
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

  const startPromise = startWorktree(name);
  worktrees.set(name, {
    state: "starting",
    startPromise,
    name,
    dashboardPort: null,
    dashboardUrl: null,
    idleTimer: null,
  });
  const ready = await startPromise;
  return ready;
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

  const fastify = execa(
    "node",
    [
      "--import=./tsx-preload.mjs",
      "--import",
      "tsx",
      "./src/webapp/server-main.ts",
      ...wt.boxes,
    ],
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
    killGroup(vite.pid);
    killGroup(fastify.pid);
    await removePidFile(name);
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
    onChildExit(name);
  });
  fastify.on("exit", (code, signal) => {
    log(`[${name}] fastify exited code=${code} signal=${signal}`);
    onChildExit(name);
  });
  // execa-promise rejection handlers are attached at spawn time above — not
  // here — so they're in place even on the waitForHttp-failure path.

  return entry;
}

let onChildExit = (name: string): void => {
  const entry = worktrees.get(name);
  if (!entry || entry.state !== "ready") return;
  entry.state = "dead";
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  stopDashboard(entry).catch(() => {});
  removePidFile(name).catch(() => {});
  worktrees.delete(name);
};

let stopWorktree = async (name: string): Promise<void> => {
  const entry = worktrees.get(name);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.state = "stopping";
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  await stopDashboard(entry).catch(() => {});
  setTimeout(() => {
    killGroup(entry.vite?.pid, "SIGKILL");
    killGroup(entry.fastify?.pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  await removePidFile(name);
  worktrees.delete(name);
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
        : `<span class="badge cold">cold (will lazy-start on click)</span>`;
    const dashLink = `<a href="/__router/dashboard/${escapeHtml(w.name)}" class="dash" target="_blank" rel="noopener" title="agent-browser dashboard for ${escapeHtml(w.name)} (starts the worktree if cold)">dashboard ↗</a>`;
    const stopForm = w.running
      ? `<form method="POST" action="/__router/stop/${escapeHtml(w.name)}" class="stopForm">
           <button type="submit" title="Tell the router to stop ${escapeHtml(w.name)} now">stop</button>
         </form>`
      : "";
    return `
      <li>
        <a href="/${escapeHtml(w.name)}/" class="name">${escapeHtml(w.name)}</a>
        ${status}
        ${dashLink}
        ${stopForm}
      </li>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>callback-mono dev router</title>
<link rel="icon" type="image/png" href="/favicon.png">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 640px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; }
  p.sub { color: #666; margin-top: 0; }
  ul { list-style: none; padding: 0; }
  li { display: flex; align-items: center; gap: 0.6em; padding: 0.5em 0; border-bottom: 1px solid #eee; }
  a.name { font-weight: 600; text-decoration: none; color: #2255aa; font-family: ui-monospace, Menlo, monospace; min-width: 12em; }
  a.name:hover { text-decoration: underline; }
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
<h1>callback-mono dev router</h1>
<p class="sub">Click a worktree to open it. Cold worktrees start on first request (~4s); running ones idle-shut-down after ${Math.round(IDLE_TIMEOUT_MS / 1000)}s.</p>
<ul>${rows}</ul>

<div class="help">
  <h2>If something looks wedged</h2>
  <p>
    Run <code>bin/worktrees panic</code> from a terminal — this kills the
    router plus every child it knows about, wipes <code>~/.cache/callback-mono</code>
    state, and frees port ${ROUTER_PORT}. Then start fresh with <code>pnpm dev</code>.
  </p>
  <p>
    Per-worktree logs are at <code>~/.cache/callback-mono/logs/&lt;name&gt;.log</code>.
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
    await stopWorktree(name);
    if (req.method === "POST") {
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
      res.end(`Worktree ${name} is running but its dashboard failed to start. See logs at ~/.cache/callback-mono/logs/${name}.log\n`);
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

  let entry: WorktreeEntry;
  try {
    entry = await ensureRunning(name);
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

  await proxyWithRetry(req, res, entry, 5);
});

server.on("upgrade", async (req, socket, head) => {
  const reqUrl = req.url || "/";
  const name = parseWorktreeName(reqUrl);
  if (!name) {
    socket.destroy();
    return;
  }
  let entry: WorktreeEntry;
  try {
    entry = await ensureRunning(name);
  } catch (err) {
    log(`[${name}] upgrade failed: ${(err as Error).message}`);
    socket.destroy();
    return;
  }
  const target = `http://127.0.0.1:${entry.frontendPort}`;
  proxy.ws(req, socket, head, { target }, (err: Error | undefined) => {
    if (err) {
      log(`[${entry.name}] ws proxy error: ${err.message}`);
      try { socket.destroy(); } catch { /* already gone */ }
    }
  });
});

async function proxyWithRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  entry: WorktreeEntry,
  retriesLeft: number,
): Promise<void> {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${entry.frontendPort}`;
    proxy.web(req, res, { target }, (err: Error & { code?: string } | undefined) => {
      if (!err) {
        resolve();
        return;
      }
      if (err.code === "ECONNREFUSED" && retriesLeft > 0) {
        log(`[${entry.name}] upstream not ready, retry (${retriesLeft} left)`);
        setTimeout(() => {
          proxyWithRetry(req, res, entry, retriesLeft - 1).then(resolve);
        }, 600);
        return;
      }
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(`Upstream unavailable: ${err.message}\n`);
      } else {
        try { res.end(); } catch { /* already ended */ }
      }
      resolve();
    });
  });
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
onChildExit = (name: string) => { _origOnExit(name); updateTabTitle(); };

// --- Boot --------------------------------------------------------------

(async () => {
  await acquireRouterPidFile();
  await sweepStaleChildren();
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
