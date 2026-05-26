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
const LOG_DIR = path.join(os.homedir(), ".cache", "callback-mono", "logs");

// Main checkout's default box list (formerly hardcoded in Procfile.dev).
const MAIN_BOX_DEFAULTS = [
  path.join(os.homedir(), "src", "boxes", "hearthside"),
  path.join(os.homedir(), "src", "boxes", "test1"),
  path.join(os.homedir(), "src", "boxes", "hearth-test"),
  path.join(os.homedir(), "src", "boxes", "studio"),
];

// --- Worktree resolution -----------------------------------------------

// Resolve a worktree name to its on-disk layout. Returns null if the worktree
// doesn't exist.
async function resolveWorktree(name) {
  if (name === "main") {
    return {
      name: "main",
      root: REPO_ROOT,
      backendCwd: path.join(REPO_ROOT, "callback-box"),
      frontendCwd: path.join(REPO_ROOT, "callback-box", "src", "frontend"),
      boxes: await readBoxes(path.join(REPO_ROOT, "callback-box", ".env"))
        ?? MAIN_BOX_DEFAULTS,
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

// --- Process supervision ----------------------------------------------

// Per-worktree state. Each entry transitions:
//   undefined → starting (startPromise) → ready → dead
const worktrees = new Map();

async function ensureRunning(name) {
  let entry = worktrees.get(name);
  if (entry?.state === "ready") {
    entry.lastActivity = Date.now();
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
    // Vite reads FRONTEND_PORT/BACKEND_PORT via its config.
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    VITE_BASE: baseUrl,
    // Fastify reads PORT directly. Same value as BACKEND_PORT but the env
    // name the backend actually consults.
    PORT: String(backendPort),
  };

  log(`[${name}] frontend=${frontendPort} backend=${backendPort} base=${baseUrl}`);

  // Spawn backend (fastify via tsx).
  // Detached so we have explicit control over lifecycle (no inheritance from
  // router's controlling terminal signals).
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

  // Spawn vite directly (no `pnpm exec` wrapper) to keep the process tree
  // flat. The frontend's `pnpm install` (run by the WorktreeCreate hook for
  // worktrees, or by the user for main) makes ./node_modules/.bin/vite
  // available.
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

  // Wait for both to listen.
  await Promise.all([
    waitForPort(frontendPort, 30000, `vite/${name}`),
    waitForPort(backendPort, 30000, `fastify/${name}`),
  ]);

  const entry = {
    state: "ready",
    name,
    vite,
    fastify,
    frontendPort,
    backendPort,
    startedAt: Date.now(),
    lastActivity: Date.now(),
    logFile,
  };
  worktrees.set(name, entry);
  log(`[${name}] ready`);

  vite.on("exit", (code, signal) => {
    log(`[${name}] vite exited code=${code} signal=${signal}`);
    markDead(name);
  });
  fastify.on("exit", (code, signal) => {
    log(`[${name}] fastify exited code=${code} signal=${signal}`);
    markDead(name);
  });
  vite.catch(() => {}); // suppress unhandled rejection on kill
  fastify.catch(() => {});

  return entry;
}

function markDead(name) {
  const entry = worktrees.get(name);
  if (entry && entry.state === "ready") {
    entry.state = "dead";
    // Make sure both children are killed (one exiting often means the other
    // should follow).
    killEntry(entry);
  }
}

function killEntry(entry) {
  for (const child of [entry.vite, entry.fastify]) {
    if (!child || child.killed) continue;
    try {
      // Kill the whole process group of the detached child.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
  }
}

async function waitForPort(port, timeoutMs, label) {
  // TCP-level liveness check: try to connect. If the socket opens, the
  // port is listening — we don't care what protocol it speaks. Try both
  // IPv4 and IPv6 since Vite binds `::1` by default on macOS and Fastify
  // typically binds 127.0.0.1.
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
  throw new Error(`${label} did not start listening on :${port} within ${timeoutMs}ms`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- HTTP proxy --------------------------------------------------------

const proxy = httpProxy.createProxyServer({
  ws: false, // HMR connects directly; we don't proxy WS
  changeOrigin: true,
  // Don't auto-add the X-Forwarded-* headers; vite is permissive without them.
});

proxy.on("error", (err, req, res) => {
  // Errors are surfaced by the per-request handler below; this is a safety
  // net for cases where the request didn't pass through ensureRunning.
  log(`proxy error: ${err.message}`);
  if (res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Bad gateway: ${err.message}\n`);
  } else if (res) {
    res.end();
  }
});

function parseWorktreeName(reqPath) {
  // /<name>/<rest> → name. Empty / or no name → null.
  const m = reqPath.match(/^\/([^/?#]+)(?:[/?#]|$)/);
  return m ? m[1] : null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";

  // Internal status endpoint.
  if (url === "/__router/status" || url === "/__router/status/") {
    res.writeHead(200, { "content-type": "application/json" });
    const state = {};
    for (const [name, entry] of worktrees) {
      state[name] = {
        state: entry.state,
        frontendPort: entry.frontendPort,
        backendPort: entry.backendPort,
        startedAt: entry.startedAt,
        lastActivity: entry.lastActivity,
      };
    }
    res.end(JSON.stringify({ port: ROUTER_PORT, worktrees: state }, null, 2));
    return;
  }

  // Root: list of worktrees.
  if (url === "/" || url === "") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(
      [
        "callback-mono dev router",
        "",
        "Pick a worktree:",
        "  /main/<box>/...   the main checkout",
        "  /<name>/<box>/... a git worktree (lazy-started on first request)",
        "",
        "Status: /__router/status",
      ].join("\n"),
    );
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

  // Proxy with retry on ECONNREFUSED (vite restart tolerance).
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

// --- Shutdown ----------------------------------------------------------

let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`shutting down: ${reason}`);
  for (const entry of worktrees.values()) {
    if (entry.vite || entry.fastify) killEntry(entry);
  }
  // Give children a moment to die.
  await sleep(500);
  server.close(() => process.exit(0));
  // Force-exit if close hangs.
  setTimeout(() => process.exit(0), 2000).unref();
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

server.listen(ROUTER_PORT, () => {
  log(`listening on http://localhost:${ROUTER_PORT}`);
  log(`open http://localhost:${ROUTER_PORT}/main/ to dev the main checkout`);
});
