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
import { escapeHtml, serveDev } from "./router-docs.js";
import {
  type WorktreeHandle,
  type CapturedError,
  transitionLifecycle,
  createStartingHandle,
  readyLifecycle,
  failedLifecycle,
  startPromiseOf,
  isServing,
  childPids,
} from "./router-lifecycle.js";
import { createPidStore, type PidRecord } from "./router-pidfile.js";

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

// Invariants #1 (single-slot) and #6 (per-name serialization) of
// bin/docs/router-protocol.md live inside the store: `write`/`remove` are
// serialized per worktree name so a `remove`'s generation-guard read+unlink is
// atomic relative to a concurrent generation's `write`. Every current-generation
// pidfile op (startWorktree, stopWorktree, onChildExit, shutdown, and a
// superseded start's self-clean) routes through here. sweepStaleChildren below
// touches pidfiles directly, but only at boot — before the server listens, so
// no worktree op can race it.
const pidStore = createPidStore(PID_DIR);

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
//
// The worktree lifecycle model (the WorktreeHandle shell, the phase union, the
// guarded transition table, and the four incident invariants it encodes) lives
// in ./router-lifecycle.ts. This file owns the effects: spawning children,
// killing them, HTTP-readiness probes, pidfiles, and driving transitions.

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

const worktrees = new Map<string, WorktreeHandle>();

function statusError(message: string, statusCode: number): StatusError {
  const err: StatusError = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function ensureRunning(name: string): Promise<WorktreeHandle> {
  const existing = worktrees.get(name);
  if (existing) {
    if (readyLifecycle(existing)) {
      touch(existing);
      return existing;
    }
    const inFlight = startPromiseOf(existing);
    if (inFlight) return inFlight;
    // Failed worktrees stay failed until the user explicitly retries (via the
    // /__router/retry/<name> endpoint). Auto-restarting on every page-fetch
    // would mask the failure and burn CPU / log noise — a broken worktree
    // should *look* broken, with the captured error visible.
    const failed = failedLifecycle(existing);
    if (failed) throw statusError(failed.lastError.message, 502);
    // Any other in-map phase is unreachable (stopping handles are unlinked
    // before the transition); fall through to start a fresh generation.
  }

  // Invariant #2 of bin/docs/router-protocol.md: atomic registration, then
  // start. Construct the handle, register it, and begin startup in ONE
  // synchronous stretch with no `await` between the worktrees.get() above and
  // the worktrees.set() below — otherwise two near-simultaneous cold requests
  // both observe an empty map, both start, and each spawns a full vite+fastify
  // pair (a leaked generation). Registration happens BEFORE begin() invokes
  // startWorktree, so even a synchronous resolver can't run before the handle
  // is in the map.
  const { handle, begin } = createStartingHandle({ name, startedAt: Date.now() });
  worktrees.set(name, handle);
  const inFlight = begin(startWorktree);
  // On rejection that ISN'T a parked waitForHttp failure (e.g. an unknown-name
  // 404 from a `/.well-known/...` probe, crawler, or typo — startWorktree throws
  // before any transition), drop the bare starting handle so it leaves no
  // phantom index entry and a later valid request can retry. The failure path
  // transitions this same handle to `failed` in place, so the still-`starting`
  // guard leaves that record intact; a superseded generation (cur !== handle)
  // is likewise left alone.
  inFlight.catch(() => {
    const cur = worktrees.get(name);
    if (cur === handle && cur.lifecycle.phase === "starting") worktrees.delete(name);
  });
  return inFlight;
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

// Record activity and (re)arm the idle timer. Only a `ready` handle has an idle
// timer; other phases are a no-op. This mutates the ready variant's idle
// bookkeeping in place — a within-phase field update, not a lifecycle
// transition.
let touch = (handle: WorktreeHandle): void => {
  const ready = readyLifecycle(handle);
  if (!ready) return;
  ready.lastActivity = Date.now();
  if (ready.idleTimer) clearTimeout(ready.idleTimer);
  ready.idleTimer = setTimeout(() => {
    log(`[${handle.name}] idle for ${IDLE_TIMEOUT_MS}ms, shutting down`);
    stopWorktree(handle.name).catch((err: Error) =>
      log(`[${handle.name}] idle shutdown error: ${err.message}`),
    );
  }, IDLE_TIMEOUT_MS);
  ready.idleTimer.unref();
};

async function startWorktree(handle: WorktreeHandle): Promise<WorktreeHandle> {
  const name = handle.name;
  const wt = await resolveWorktree(name);
  if (!wt) throw statusError(`Worktree ${JSON.stringify(name)} not found`, 404);
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
  // Invariant #3 of bin/docs/router-protocol.md: swallow execa rejection at spawn time.
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

  await pidStore.write(name, {
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

  // SIGTERM→SIGKILL escalation for this generation's children — shared by the
  // failure path and the superseded-start self-clean (invariant #5). A vite
  // that's slow to die on SIGTERM (e.g. mid esbuild/optimizeDeps) would
  // otherwise survive as an orphan, and the pidfile is removed right after so
  // the sweep couldn't find it either.
  const killOwnChildren = (): void => {
    killGroup(vite.pid);
    killGroup(fastify.pid);
    setTimeout(() => {
      killGroup(vite.pid, "SIGKILL");
      killGroup(fastify.pid, "SIGKILL");
    }, KILL_GRACE_MS).unref();
  };

  // Wait for both to serve HTTP — not just accept TCP.
  try {
    await Promise.all([
      waitForHttp(frontendPort, baseUrl, 30000, `vite/${name}`),
      waitForHttp(backendPort, "/healthz", 30000, `fastify/${name}`),
    ]);
  } catch (err) {
    killOwnChildren();
    // The dashboard daemon started before waitForHttp; stop it too so a failed
    // startup doesn't leak an agent-browser process.
    if (dashboardStarted) {
      await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
        env: browseEnv,
        stdio: "ignore",
        timeout: 5000,
      }).catch(() => { /* nothing to stop, fine */ });
    }
    await pidStore.remove(name, { vitePid: vite.pid, fastifyPid: fastify.pid });
    const captured: CapturedError = {
      message: (err as Error).message,
      phase: "waitForHttp",
      viteOutput: viteOutputRing.read(),
      fastifyOutput: fastifyOutputRing.read(),
      at: Date.now(),
    };
    log(`[${name}] startup failed in ${captured.phase}: ${captured.message}`);
    // Invariant #5: guarded publication at the failure terminal too. If a stop
    // (or a newer generation) superseded us while we were failing, DON'T park a
    // `failed` record — this handle is off the map, so terminate it as
    // `stopping` (self-clean semantics) and let the generation that owns the
    // slot stand. Only the current generation publishes its `failed` record
    // (which the HTTP handler and /__router/retry/<name> read to render the
    // error page; ensureRunning won't auto-restart a failed worktree).
    if (worktrees.get(name) !== handle) {
      log(`[${name}] startup failed but this generation was superseded — not publishing failure`);
      transitionLifecycle(handle, {
        phase: "stopping",
        reason: "requested",
        vitePid: vite.pid,
        fastifyPid: fastify.pid,
        dashboardPort: dashboardStarted ? dashboardPort : null,
        browseEnv,
      });
      throw statusError(captured.message, 502);
    }
    transitionLifecycle(handle, { phase: "failed", lastError: captured });
    throw statusError(captured.message, 502);
  }

  // Invariant #5: guarded publication. A `/__router/stop/<name>` (or a newer
  // generation) during this cold start unlinks the handle from the map; if that
  // happened, DON'T publish — kill our own children, remove our own pidfile, and
  // resolve without reappearing in the map (the completed start must not
  // silently resurrect a worktree the user stopped, nor clobber a replacement).
  if (worktrees.get(name) !== handle) {
    log(`[${name}] startup finished but this generation was superseded — self-cleaning, not publishing`);
    killOwnChildren();
    if (dashboardStarted) {
      await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
        env: browseEnv,
        stdio: "ignore",
        timeout: 5000,
      }).catch(() => { /* nothing to stop, fine */ });
    }
    await pidStore.remove(name, { vitePid: vite.pid, fastifyPid: fastify.pid });
    transitionLifecycle(handle, {
      phase: "stopping",
      reason: "requested",
      vitePid: vite.pid,
      fastifyPid: fastify.pid,
      dashboardPort: dashboardStarted ? dashboardPort : null,
      browseEnv,
    });
    return handle;
  }

  // Still the current generation — publish `ready` by transitioning the same
  // handle in place (it has been in the map since ensureRunning registered it;
  // no map replacement, so the identity guards stay valid).
  transitionLifecycle(handle, {
    phase: "ready",
    vitePid: vite.pid,
    fastifyPid: fastify.pid,
    frontendPort,
    backendPort,
    dashboardPort: dashboardStarted ? dashboardPort : null,
    dashboardUrl: dashboardStarted ? `http://localhost:${dashboardPort}/` : null,
    socketDir,
    profileDir,
    browseEnv,
    logFile,
    lastActivity: Date.now(),
    idleTimer: null,
  });
  touch(handle);
  log(`[${name}] ready`);

  vite.on("exit", (code, signal) => {
    log(`[${name}] vite exited code=${code} signal=${signal}`);
    onChildExit(handle);
  });
  fastify.on("exit", (code, signal) => {
    log(`[${name}] fastify exited code=${code} signal=${signal}`);
    onChildExit(handle);
  });
  // execa-promise rejection handlers are attached at spawn time above — not
  // here — so they're in place even on the waitForHttp-failure path.

  return handle;
}

// Invariant #4 of bin/docs/router-protocol.md: verify generation identity before tearing down.
// A child's exit event can arrive long after its generation was replaced —
// fastify drains open browser sockets for ~10s after SIGTERM, by which time a
// reconnecting client has often already spawned the next generation under the
// same name. Tearing down by name alone let those late exits kill the *new*
// generation, which the client then restarted, killing the next one: a
// self-sustaining restart storm with a fresh vite port every cycle (the
// 2026-06-09 "main restarts every 10s" incident). Every teardown must
// therefore verify the exiting child belongs to the entry currently in the
// map, and stale exits reduce to a log line.
// An unexpected exit of a `ready` generation's child (crash, or a drained
// SIGTERM finally landing). Invariant #4: verify the exiting child still belongs
// to the map's current handle — a late exit from a replaced generation reduces
// to a log line, never a teardown of the live entry (the 2026-06-09 "main
// restarts every 10s" incident). Reason "exited" → detached, fire-and-forget
// cleanup (no caller is awaiting an unexpected death).
let onChildExit = (handle: WorktreeHandle): void => {
  const name = handle.name;
  if (worktrees.get(name) !== handle) {
    log(`[${name}] exit event from a replaced generation, ignoring`);
    return;
  }
  const ready = readyLifecycle(handle);
  if (!ready) return;
  if (ready.idleTimer) clearTimeout(ready.idleTimer);
  const { vitePid, fastifyPid } = ready;
  worktrees.delete(name);
  transitionLifecycle(handle, {
    phase: "stopping",
    reason: "exited",
    vitePid,
    fastifyPid,
    dashboardPort: ready.dashboardPort,
    browseEnv: ready.browseEnv,
  });
  killGroup(vitePid);
  killGroup(fastifyPid);
  setTimeout(() => {
    killGroup(vitePid, "SIGKILL");
    killGroup(fastifyPid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  stopDashboard(handle).catch(() => {});
  pidStore.remove(name, { vitePid, fastifyPid }).catch(() => {});
};

// Explicit/idle stop. Reason "requested" → cleanup is AWAITED (the retry
// endpoint relies on stopWorktree completion). Unlink from the map before any
// await so a request arriving mid-stop sees a cold worktree and starts a fresh
// generation, and this cleanup can never delete that new generation's state.
let stopWorktree = async (name: string): Promise<void> => {
  const handle = worktrees.get(name);
  if (!handle) return;
  worktrees.delete(name);
  const ready = readyLifecycle(handle);
  if (!ready) {
    // `starting`: the in-flight start owns the children (they live in
    //   startWorktree's scope) and self-cleans on its guarded publication now
    //   that we've unlinked it (invariant #5) — nothing to kill here.
    // `failed`: nothing is running; dropping it from the map is the whole stop.
    return;
  }
  if (ready.idleTimer) clearTimeout(ready.idleTimer);
  const { vitePid, fastifyPid } = ready;
  transitionLifecycle(handle, {
    phase: "stopping",
    reason: "requested",
    vitePid,
    fastifyPid,
    dashboardPort: ready.dashboardPort,
    browseEnv: ready.browseEnv,
  });
  killGroup(vitePid);
  killGroup(fastifyPid);
  setTimeout(() => {
    killGroup(vitePid, "SIGKILL");
    killGroup(fastifyPid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  await pidStore.remove(name, { vitePid, fastifyPid });
  await stopDashboard(handle).catch(() => {});
};

// Stop the agent-browser dashboard daemon for a handle in a phase that owns one
// (`ready` or `stopping`). Other phases carry no dashboard, so this is a no-op.
async function stopDashboard(handle: WorktreeHandle): Promise<void> {
  const lc = handle.lifecycle;
  const dashboard =
    lc.phase === "ready" || lc.phase === "stopping"
      ? { dashboardPort: lc.dashboardPort, browseEnv: lc.browseEnv }
      : null;
  if (!dashboard || !dashboard.dashboardPort || !dashboard.browseEnv) return;
  try {
    await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
      env: dashboard.browseEnv,
      stdio: "ignore",
      timeout: 5000,
    });
  } catch (err) {
    log(`[${handle.name}] dashboard stop failed: ${(err as Error).message}`);
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
  handle?: WorktreeHandle;
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
  for (const [name, handle] of worktrees) {
    const existing = all.get(name) ?? { name, running: false };
    all.set(name, { ...existing, running: isServing(handle), handle });
  }
  return Array.from(all.values()).sort((a, b) =>
    a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name),
  );
}

async function renderIndex(): Promise<string> {
  const list = await discoverWorktrees();
  const rows = list.map((w) => {
    const ready = w.handle ? readyLifecycle(w.handle) : null;
    const status = w.handle && failedLifecycle(w.handle)
      ? `<span class="badge failed">failed · <a href="/${escapeHtml(w.name)}/">see error</a></span>`
      : ready
        ? `<span class="badge running">running · idle ${Math.round((Date.now() - ready.lastActivity) / 1000)}s</span>`
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
// worktree's vite/fastify (you can read docs from a cold worktree). The
// rendering itself (HTML shell, manifest, doc browser, artifact serving)
// lives in ./router-docs.ts; this function stays here because it's the only
// piece that needs this file's MAIN_ROOT/WORKTREES_ROOT config.
function worktreeRoot(name: string): string {
  return name === "main" ? MAIN_ROOT : path.join(WORKTREES_ROOT, name);
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
      const handle = worktrees.get(w.name);
      if (!handle) {
        state[w.name] = { state: "cold" };
        continue;
      }
      const ready = readyLifecycle(handle);
      if (ready) {
        state[w.name] = {
          state: "ready",
          frontendPort: ready.frontendPort,
          backendPort: ready.backendPort,
          dashboardPort: ready.dashboardPort,
          dashboardUrl: ready.dashboardUrl,
          vitePid: ready.vitePid,
          fastifyPid: ready.fastifyPid,
          socketDir: ready.socketDir,
          profileDir: ready.profileDir,
          startedAt: handle.startedAt,
          lastActivity: ready.lastActivity,
          idleMs: Date.now() - ready.lastActivity,
        };
      } else {
        // starting / failed — the only other in-map phases (stopping handles
        // are unlinked before the transition). Ports/pids aren't meaningful yet.
        state[w.name] = { state: handle.lifecycle.phase, startedAt: handle.startedAt };
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
    if (existing && failedLifecycle(existing)) {
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
    let handle: WorktreeHandle;
    try {
      handle = await ensureRunning(name);
    } catch (err) {
      const status = (err as StatusError).statusCode ?? 502;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(`Failed to start worktree ${name}: ${(err as Error).message}\n`);
      return;
    }
    const dashboardUrl = readyLifecycle(handle)?.dashboardUrl ?? null;
    if (!dashboardUrl) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Worktree ${name} is running but its dashboard failed to start. See logs at ~/.cache/callback-box/logs/${name}.log\n`);
      return;
    }
    res.writeHead(302, { location: dashboardUrl });
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
    await serveDev({ name, rest: afterName, res, repoRoot: worktreeRoot(name), mainRoot: MAIN_ROOT, worktreesRoot: WORKTREES_ROOT });
    return;
  }

  try {
    await ensureRunning(name);
  } catch (err) {
    const status = (err as StatusError).statusCode ?? 502;
    // If we have a captured failure for this worktree, render the rich
    // HTML error page (stderr tail + retry button). Otherwise fall back
    // to plain text (e.g. 404 for unknown worktree name).
    const failedHandle = worktrees.get(name);
    const failed = failedHandle ? failedLifecycle(failedHandle) : null;
    if (failed) {
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
  let handle = worktrees.get(name);
  const inFlight = handle ? startPromiseOf(handle) : null;
  if (inFlight) {
    // A cold start is already underway (triggered by an HTTP request) — let
    // the socket wait for it rather than refusing and forcing a retry cycle.
    try {
      handle = await inFlight;
    } catch (err) {
      log(`[${name}] upgrade failed: ${(err as Error).message}`);
      socket.destroy();
      return;
    }
  }
  const ready = handle ? readyLifecycle(handle) : null;
  if (!handle || !ready) {
    const last = refusedUpgradeLogAt.get(name) ?? 0;
    if (Date.now() - last > 60_000) {
      refusedUpgradeLogAt.set(name, Date.now());
      log(`[${name}] refusing WS upgrade while not running (logged at most once/min)`);
    }
    socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    return;
  }
  touch(handle);
  const target = `http://127.0.0.1:${ready.frontendPort}`;
  proxy.ws(req, socket, head, { target }, (err: Error | undefined) => {
    if (err) {
      log(`[${name}] ws proxy error: ${err.message}`);
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
  { frontendPort, body }: { frontendPort: number; body: Buffer | null },
): Promise<(Error & { code?: string }) | undefined> {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${frontendPort}`;
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
    let handle: WorktreeHandle;
    try {
      // Re-resolve every attempt: after a kill/restart race the worktree's
      // new generation listens on different ports, so retrying the original
      // target would hammer a dead port. ensureRunning also restarts a
      // worktree that died between request arrival and proxying — the HTTP
      // request already established user intent.
      handle = await ensureRunning(name);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead((err as StatusError).statusCode ?? 502, { "content-type": "text/plain" });
        res.end(`Failed to start worktree ${name}: ${(err as Error).message}\n`);
      }
      return;
    }
    // A start that was superseded mid-flight (invariant #5) resolves to a
    // non-ready handle; treat it like a transient upstream and retry, which
    // re-runs ensureRunning against the fresh generation (or cold-starts one).
    const ready = readyLifecycle(handle);
    let err: (Error & { code?: string }) | undefined;
    if (ready) {
      err = await proxyOnce(req, res, { frontendPort: ready.frontendPort, body });
    } else {
      const notReady: Error & { code?: string } = new Error(`worktree ${name} not ready`);
      notReady.code = "ECONNREFUSED";
      err = notReady;
    }
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
  for (const handle of worktrees.values()) {
    const ready = readyLifecycle(handle);
    if (ready?.idleTimer) clearTimeout(ready.idleTimer);
    const { vitePid, fastifyPid } = childPids(handle.lifecycle);
    killGroup(vitePid);
    killGroup(fastifyPid);
  }
  setTimeout(() => {
    for (const handle of worktrees.values()) {
      const { vitePid, fastifyPid } = childPids(handle.lifecycle);
      killGroup(vitePid, "SIGKILL");
      killGroup(fastifyPid, "SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
  await sleep(500);
  for (const name of worktrees.keys()) {
    await pidStore.remove(name);
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
  const running = [...worktrees.values()].filter((h) => isServing(h));
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
touch = (handle: WorktreeHandle) => { _origTouch(handle); updateTabTitle(); };
const _origStop = stopWorktree;
stopWorktree = async (name: string) => { await _origStop(name); updateTabTitle(); };
const _origOnExit = onChildExit;
onChildExit = (handle: WorktreeHandle) => { _origOnExit(handle); updateTabTitle(); };

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
