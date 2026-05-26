#!/usr/bin/env node
// Dev router for the callback-mono monorepo.
//
// Listens on a single user-facing port (default 3210) and lazily spawns a
// Vite + Fastify pair for each worktree on first request to that worktree's
// URL prefix. URLs look like:
//
//   http://localhost:3210/main/test1/dashboard         → main checkout
//   http://localhost:3210/foo/test1-foo/inbox/...      → worktree "foo"
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
import net from "node:net";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execa } from "execa";
import getPort from "get-port";
import httpProxy from "http-proxy";

// --- Configuration -----------------------------------------------------

const ROUTER_PORT = Number(process.env.ROUTER_PORT) || 3210;
const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "..");
const WORKTREES_ROOT = path.join(os.homedir(), "src", "callback-worktrees");
const BOXES_ROOT = path.join(os.homedir(), "src", "box-worktrees");
const STATE_DIR = path.join(os.homedir(), ".cache", "callback-mono");
const LOG_DIR = path.join(STATE_DIR, "logs");
const PID_DIR = path.join(STATE_DIR, "pids");
const ROUTER_PID_FILE = path.join(STATE_DIR, "router.pid");

// Idle window before a worktree's children are shut down (ms).
const IDLE_TIMEOUT_MS = Number(process.env.ROUTER_IDLE_MS) || 5 * 60 * 1000;

// How long after SIGTERM before we escalate to SIGKILL.
const KILL_GRACE_MS = 2000;

// Main checkout's default box list (formerly hardcoded in Procfile.dev).
const MAIN_BOX_DEFAULTS = [
  path.join(os.homedir(), "src", "boxes", "hearthside"),
  path.join(os.homedir(), "src", "boxes", "test1"),
  path.join(os.homedir(), "src", "boxes", "hearth-test"),
  path.join(os.homedir(), "src", "boxes", "studio"),
];

// --- Worktree resolution -----------------------------------------------

async function resolveWorktree(name) {
  if (name === "main") {
    return {
      name: "main",
      root: REPO_ROOT,
      backendCwd: path.join(REPO_ROOT, "callback-box"),
      frontendCwd: path.join(REPO_ROOT, "callback-box", "src", "frontend"),
      boxes:
        (await readBoxes(path.join(REPO_ROOT, "callback-box", ".env"))) ??
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
    boxes: boxes ?? [path.join(BOXES_ROOT, `test1-${name}`)],
  };
}

async function readBoxes(envPath) {
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

async function writePidFile(name, data) {
  await fs.mkdir(PID_DIR, { recursive: true });
  await fs.writeFile(
    path.join(PID_DIR, `${name}.json`),
    JSON.stringify(data, null, 2),
  );
}

async function removePidFile(name) {
  try {
    await fs.unlink(path.join(PID_DIR, `${name}.json`));
  } catch {
    // Already gone — fine.
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // exists but not ours; still treat as alive
  }
}

// Read PID files left behind by any previous router and kill any processes
// that are still alive. Runs once on router startup. Idempotent.
async function sweepStaleChildren() {
  let files;
  try {
    files = await fs.readdir(PID_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const fullPath = path.join(PID_DIR, file);
    let data;
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
        try { process.kill(pid, "SIGTERM"); } catch {}
      }
      // Don't wait long; we proceed even if the kill takes effect later.
    }
    await fs.unlink(fullPath).catch(() => {});
  }
}

// --- Process supervision ----------------------------------------------

const worktrees = new Map(); // name → entry

async function ensureRunning(name) {
  let entry = worktrees.get(name);
  if (entry?.state === "ready") {
    touch(entry);
    return entry;
  }
  if (entry?.startPromise) return entry.startPromise;

  const startPromise = startWorktree(name).catch((err) => {
    worktrees.delete(name);
    throw err;
  });
  worktrees.set(name, { state: "starting", startPromise, name });
  const ready = await startPromise;
  return ready;
}

function touch(entry) {
  entry.lastActivity = Date.now();
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    log(`[${entry.name}] idle for ${IDLE_TIMEOUT_MS}ms, shutting down`);
    stopWorktree(entry.name).catch((err) =>
      log(`[${entry.name}] idle shutdown error: ${err.message}`),
    );
  }, IDLE_TIMEOUT_MS);
  entry.idleTimer.unref(); // don't keep the event loop alive
}

async function startWorktree(name) {
  const wt = await resolveWorktree(name);
  if (!wt) {
    const err = new Error(`Worktree ${JSON.stringify(name)} not found`);
    err.statusCode = 404;
    throw err;
  }
  log(`[${name}] starting`);

  await fs.mkdir(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.write(`\n=== router start ${new Date().toISOString()} ===\n`);

  const [frontendPort, backendPort] = await Promise.all([getPort(), getPort()]);

  const baseUrl = `/${name}/`;
  const childEnv = {
    ...process.env,
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    VITE_BASE: baseUrl,
    PORT: String(backendPort), // Fastify reads PORT
  };

  log(`[${name}] frontend=${frontendPort} backend=${backendPort} base=${baseUrl}`);

  // Backend: node + tsx, single process.
  const fastify = execa(
    "node",
    [
      "--import=./tsx-preload.mjs",
      "--import",
      "tsx",
      "./src/webapp/server.ts",
      ...wt.boxes,
    ],
    {
      cwd: wt.backendCwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cleanup: true,
    },
  );
  fastify.stdout?.pipe(logStream, { end: false });
  fastify.stderr?.pipe(logStream, { end: false });

  // Vite: direct binary, no pnpm wrapper.
  const viteBin = path.join(wt.frontendCwd, "node_modules", ".bin", "vite");
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
  );
  vite.stdout?.pipe(logStream, { end: false });
  vite.stderr?.pipe(logStream, { end: false });

  // Record PIDs early so a crash mid-startup still leaves a sweep target.
  await writePidFile(name, {
    name,
    vitePid: vite.pid,
    fastifyPid: fastify.pid,
    frontendPort,
    backendPort,
    routerPid: process.pid,
    startedAt: Date.now(),
  });

  // Wait for both to listen.
  try {
    await Promise.all([
      waitForPort(frontendPort, 30000, `vite/${name}`),
      waitForPort(backendPort, 30000, `fastify/${name}`),
    ]);
  } catch (err) {
    // Startup failed; kill anything we managed to spawn and clean up.
    killGroup(vite.pid);
    killGroup(fastify.pid);
    await removePidFile(name);
    throw err;
  }

  const entry = {
    state: "ready",
    name,
    vite,
    fastify,
    frontendPort,
    backendPort,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    idleTimer: null,
    logFile,
  };
  worktrees.set(name, entry);
  touch(entry); // start the idle timer
  log(`[${name}] ready`);

  vite.on("exit", (code, signal) => {
    log(`[${name}] vite exited code=${code} signal=${signal}`);
    onChildExit(name);
  });
  fastify.on("exit", (code, signal) => {
    log(`[${name}] fastify exited code=${code} signal=${signal}`);
    onChildExit(name);
  });
  vite.catch(() => {});
  fastify.catch(() => {});

  return entry;
}

function onChildExit(name) {
  const entry = worktrees.get(name);
  if (!entry || entry.state !== "ready") return;
  entry.state = "dead";
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  // Kill the sibling if it's still alive.
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  removePidFile(name).catch(() => {});
  worktrees.delete(name);
}

async function stopWorktree(name) {
  const entry = worktrees.get(name);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.state = "stopping";
  killGroup(entry.vite?.pid);
  killGroup(entry.fastify?.pid);
  // Escalation: if still alive after KILL_GRACE_MS, SIGKILL.
  setTimeout(() => {
    killGroup(entry.vite?.pid, "SIGKILL");
    killGroup(entry.fastify?.pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  await removePidFile(name);
  worktrees.delete(name);
}

function killGroup(pid, sig = "SIGTERM") {
  if (!pid) return;
  try {
    process.kill(-pid, sig); // group
  } catch {
    try {
      process.kill(pid, sig); // single
    } catch {
      /* gone */
    }
  }
}

async function waitForPort(port, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const host of ["127.0.0.1", "::1"]) {
      const ok = await new Promise((resolve) => {
        const sock = net.connect({ host, port });
        sock.once("connect", () => {
          sock.end();
          resolve(true);
        });
        sock.once("error", () => resolve(false));
        sock.setTimeout(500, () => {
          sock.destroy();
          resolve(false);
        });
      });
      if (ok) return;
    }
    await sleep(150);
  }
  throw new Error(
    `${label} did not start listening on :${port} within ${timeoutMs}ms`,
  );
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- HTTP proxy --------------------------------------------------------

const proxy = httpProxy.createProxyServer({
  ws: false, // HMR connects directly; we don't proxy WS
  changeOrigin: true,
});

proxy.on("error", (err, req, res) => {
  log(`proxy error: ${err.message}`);
  if (res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Bad gateway: ${err.message}\n`);
  } else if (res) {
    try { res.end(); } catch {}
  }
});

function parseWorktreeName(reqPath) {
  const m = reqPath.match(/^\/([^/?#]+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  if (url === "/__router/status" || url === "/__router/status/") {
    res.writeHead(200, { "content-type": "application/json" });
    const state = {};
    for (const [name, entry] of worktrees) {
      state[name] = {
        state: entry.state,
        frontendPort: entry.frontendPort,
        backendPort: entry.backendPort,
        vitePid: entry.vite?.pid,
        fastifyPid: entry.fastify?.pid,
        startedAt: entry.startedAt,
        lastActivity: entry.lastActivity,
        idleMs: entry.lastActivity ? Date.now() - entry.lastActivity : null,
      };
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

  // Manual stop endpoint (used by WorktreeRemove hook and bin/worktrees down).
  if (url.startsWith("/__router/stop/")) {
    const name = url.slice("/__router/stop/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
      return;
    }
    await stopWorktree(name);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`stopped ${name}\n`);
    return;
  }

  if (url === "/" || url === "") {
    const lines = ["callback-mono dev router", ""];
    lines.push("Active worktrees:");
    if (worktrees.size === 0) lines.push("  (none — they start lazily)");
    for (const [name, entry] of worktrees) {
      lines.push(`  /${name}/   ${entry.state}   started ${new Date(entry.startedAt).toISOString()}`);
    }
    lines.push("");
    lines.push("Available URL shapes:");
    lines.push("  /main/<box>/...   the main checkout");
    lines.push("  /<name>/<box>/... a git worktree (lazy-started on first request)");
    lines.push("");
    lines.push("Status JSON: /__router/status");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(lines.join("\n"));
    return;
  }

  const name = parseWorktreeName(url);
  if (!name) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no worktree in path\n");
    return;
  }

  let entry;
  try {
    entry = await ensureRunning(name);
  } catch (err) {
    res.writeHead(err.statusCode ?? 502, { "content-type": "text/plain" });
    res.end(`Failed to start worktree ${name}: ${err.message}\n`);
    return;
  }

  await proxyWithRetry(req, res, entry, 5);
});

async function proxyWithRetry(req, res, entry, retriesLeft) {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${entry.frontendPort}`;
    proxy.web(req, res, { target }, (err) => {
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
        try { res.end(); } catch {}
      }
      resolve();
    });
  });
}

// --- Router PID file ---------------------------------------------------

async function acquireRouterPidFile() {
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
    if (e.code !== "ENOENT") {
      if (e.message.startsWith("Another router")) throw e;
      // Otherwise the file is malformed; overwrite it.
    }
  }
  await fs.writeFile(ROUTER_PID_FILE, String(process.pid));
}

// --- Shutdown ----------------------------------------------------------

let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down: ${reason}`);
  for (const entry of worktrees.values()) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    killGroup(entry.vite?.pid);
    killGroup(entry.fastify?.pid);
  }
  // Escalate any survivors after the grace window.
  setTimeout(() => {
    for (const entry of worktrees.values()) {
      killGroup(entry.vite?.pid, "SIGKILL");
      killGroup(entry.fastify?.pid, "SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
  await sleep(500);
  // Remove PID files for cleanly-stopped worktrees.
  for (const name of worktrees.keys()) {
    await removePidFile(name);
  }
  await fs.unlink(ROUTER_PID_FILE).catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), KILL_GRACE_MS + 500).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
  shutdown("uncaughtException");
});

function log(msg) {
  console.log(`[router ${new Date().toISOString()}] ${msg}`);
}

// --- Boot --------------------------------------------------------------

(async () => {
  await acquireRouterPidFile();
  await sweepStaleChildren();
  server.listen(ROUTER_PORT, () => {
    log(`listening on http://localhost:${ROUTER_PORT}  (pid ${process.pid})`);
    log(`open http://localhost:${ROUTER_PORT}/main/ to dev the main checkout`);
    log(`idle timeout: ${IDLE_TIMEOUT_MS}ms`);
  });
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
