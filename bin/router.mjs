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
// Where /main/ is served from. Defaults to the canonical checkout so that a
// router started from a worktree (e.g. while iterating on router.mjs itself)
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

// Path to upstream agent-browser shim (resolves to the right native binary).
const AGENT_BROWSER_BIN = path.join(REPO_ROOT, "node_modules", "agent-browser", "bin", "agent-browser.js");

function browseDirsFor(name) {
  const base = path.join(BROWSE_DIR, name);
  return { base, socketDir: path.join(base, "socket"), profileDir: path.join(base, "profile") };
}

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
    // Dashboard daemonizes itself and writes its own pidfile in socketDir.
    if (typeof data.socketDir === "string") {
      try {
        const dashPidStr = await fs.readFile(path.join(data.socketDir, "dashboard.pid"), "utf8");
        const dashPid = Number.parseInt(dashPidStr.trim(), 10);
        if (Number.isFinite(dashPid) && pidAlive(dashPid)) {
          log(`sweep: killing leftover dashboard pid ${dashPid} from ${file}`);
          try { process.kill(dashPid, "SIGTERM"); } catch {}
        }
      } catch { /* no dashboard pidfile, fine */ }
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

  const [frontendPort, backendPort, dashboardPort] = await Promise.all([getPort(), getPort(), getPort()]);
  const { socketDir, profileDir } = browseDirsFor(name);
  await Promise.all([
    fs.mkdir(socketDir, { recursive: true }),
    fs.mkdir(profileDir, { recursive: true }),
  ]);

  const baseUrl = `/${name}/`;
  const childEnv = {
    ...process.env,
    FRONTEND_PORT: String(frontendPort),
    BACKEND_PORT: String(backendPort),
    VITE_BASE: baseUrl,
    PORT: String(backendPort), // Fastify reads PORT
  };
  const browseEnv = {
    ...process.env,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
    AGENT_BROWSER_PROFILE: profileDir,
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(IDLE_TIMEOUT_MS),
  };

  log(`[${name}] frontend=${frontendPort} backend=${backendPort} dashboard=${dashboardPort} base=${baseUrl}`);

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

  // Start the per-worktree agent-browser dashboard. It daemonizes itself
  // (returns once started) and writes its PID into <socketDir>/dashboard.pid.
  // Non-fatal: if it fails, the worktree still serves; dashboardUrl is null.
  // The dashboard daemonizes itself — its forked child inherits our stdio fds
  // and keeps them open after the parent exits, so we must use stdio "ignore"
  // (otherwise execa hangs forever waiting on those fds).
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
    log(`[${name}] dashboard failed to start: ${err.message}`);
  }

  // Record PIDs early so a crash mid-startup still leaves a sweep target.
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
  stopDashboard(entry).catch(() => {});
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
  await stopDashboard(entry).catch(() => {});
  // Escalation: if still alive after KILL_GRACE_MS, SIGKILL.
  setTimeout(() => {
    killGroup(entry.vite?.pid, "SIGKILL");
    killGroup(entry.fastify?.pid, "SIGKILL");
  }, KILL_GRACE_MS).unref();
  await removePidFile(name);
  worktrees.delete(name);
}

async function stopDashboard(entry) {
  if (!entry.dashboardPort || !entry.browseEnv) return;
  try {
    await execa("node", [AGENT_BROWSER_BIN, "dashboard", "stop"], {
      env: entry.browseEnv,
      stdio: "ignore",
      timeout: 5000,
    });
  } catch (err) {
    log(`[${entry.name}] dashboard stop failed: ${err.message}`);
  }
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

// Discover every worktree that *could* be served, whether currently running
// or not. Main is always present; worktrees come from ~/src/callback-worktrees/.
async function discoverWorktrees() {
  const all = new Map(); // name → { name, running, entry? }
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
    const existing = all.get(name) ?? { name };
    all.set(name, { ...existing, running: entry.state === "ready", entry });
  }
  return Array.from(all.values()).sort((a, b) =>
    a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name),
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function renderIndex() {
  const list = await discoverWorktrees();
  const rows = list.map((w) => {
    const status = w.running
      ? `<span class="badge running">running · idle ${Math.round((Date.now() - w.entry.lastActivity) / 1000)}s</span>`
      : `<span class="badge cold">cold (will lazy-start on click)</span>`;
    // Always link to the redirector — for cold worktrees it'll lazy-start
    // and then 302 to the actual dashboard URL.
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
</div>

<footer>
  <a href="/__router/status">status JSON</a>
</footer>
</body>
</html>
`;
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

  // Manual stop endpoint (used by WorktreeRemove hook, bin/worktrees down,
  // and the "stop" buttons on the index page). Accepts GET or POST; on POST
  // from a form submission, redirect back to the index instead of returning
  // a plain-text response so the user lands on a useful page.
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

  // Dashboard redirector: lazy-starts the worktree (which also brings up its
  // dashboard), then 302s the browser to the dashboard's own port. Lets the
  // home page link to dashboards for cold worktrees too — the user clicks,
  // waits a few seconds, lands on the dashboard.
  if (url.startsWith("/__router/dashboard/")) {
    const name = url.slice("/__router/dashboard/".length).replace(/\/$/, "");
    if (!name) {
      res.writeHead(400);
      res.end("missing worktree name");
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

  const name = parseWorktreeName(url);
  if (!name) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("no worktree in path\n");
    return;
  }

  // Redirect /<name> → /<name>/ so Vite's base-prefixed routing has the
  // trailing slash it expects. Otherwise the page loads but most asset URLs
  // resolve relative to "/" instead of "/<name>/", breaking everything.
  if (url === `/${name}`) {
    res.writeHead(301, { location: `/${name}/` });
    res.end();
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

// --- Terminal tab title -----------------------------------------------

// Emit an OSC-0 escape sequence so Terminal.app (and most other terminals)
// shows something useful in the tab/window title. Updated on worktree
// state changes so you can glance at the tab and tell what's busy. Only
// emit if stdout is a TTY — otherwise we'd litter pipe/log output with
// escape codes.
function setTabTitle(title) {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function updateTabTitle() {
  const running = [...worktrees.values()].filter((e) => e.state === "ready");
  let title = `⚡ cb router :${ROUTER_PORT}`;
  if (running.length === 1) {
    title += ` · ${running[0].name}`;
  } else if (running.length > 1) {
    title += ` · ${running.length} worktrees`;
  }
  setTabTitle(title);
}

// Hook into the worktree state transitions we already have, so the title
// stays current.
const _origTouch = touch;
touch = (entry) => { _origTouch(entry); updateTabTitle(); };
const _origStop = stopWorktree;
stopWorktree = async (name) => { const r = await _origStop(name); updateTabTitle(); return r; };
const _origOnExit = onChildExit;
onChildExit = (name) => { _origOnExit(name); updateTabTitle(); };

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
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
