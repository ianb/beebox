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
// STRUCTURE (2026-07-11, Phase B of the state formalization): the worktree
// lifecycle engine lives in ./router-core.ts (`createRouterCore(effects, config)`,
// owning the worktrees map and driving transitions through injected effects);
// the state model lives in ./router-lifecycle.ts; the serialized pidfile store in
// ./router-pidfile.ts. THIS file builds the REAL effects (execa, get-port,
// http.request probes, the pidfile store), wires the core to the HTTP/WS server,
// and runs the boot + signal-handler sequence in `main()`. Importing this module
// binds no ports and installs no signal handlers — only `main()` does, and it
// runs only when this file is executed directly.
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
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { Socket } from "node:net";
import { execa } from "execa";
import getPort from "get-port";
import httpProxy from "http-proxy-3";
import { reclaimOrphans } from "./process-cleanup.js";
import { injectBasePrefix } from "../callback-box/src/webapp/base-prefix.js";
import { resolveBoxEntries, type ResolvedBoxEntry } from "./box-entry.js";
import { authorizeRouterRequest, type RouterAuthDeps, type RouterAuthDecision } from "./router-auth.js";
import { createRouterAuthDeps } from "./router-auth-deps.js";
import { rewriteMobileCookiePath } from "./router-cookie.js";
import {
  bootstrapMobileSessionCookie,
  mobileBootstrapTarget,
  type MobileBootstrapTarget,
} from "./router-mobile-bootstrap.js";
import { escapeHtml, serveDev } from "./router-docs.js";
import { serveSite } from "./router-site.js";
import { serveStoryEvalSave } from "./router-story-eval.js";
import { legacyIssuesRedirect, serveWorkstreams } from "./router-workstreams.js";
import {
  type WorktreeHandle,
  type CapturedError,
  type TimerHandle,
  readyLifecycle,
  failedLifecycle,
  startPromiseOf,
  isServing,
  childPids,
} from "./router-lifecycle.js";
import { createPidStore, type PidRecord } from "./router-pidfile.js";
import {
  createRouterCore,
  errMessage,
  errnoCode,
  httpStatusOf,
  listenLoopback,
  readEnvFile,
  type RouterCore,
  type RouterEffects,
  type ResolvedWorktree,
} from "./router-core.js";

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
// The local trust boundary (plan Track B): a SECOND listener on a Unix-domain
// socket. Requests arriving on it are `trustedLocal` (unauthenticated) because a
// browser cannot originate a UDS connection — a real capability boundary, not a
// spoofable header. Local CLI (bin/workstreams) talks to the router through this;
// everything on the TCP listener (which Tailscale Serve fronts) must authenticate.
const ROUTER_SOCK = path.join(STATE_DIR, "router.sock");

// Verbose worktree-lifecycle logging (e.g. WS-upgrade refusals to idle-stopped
// worktrees — designed behavior, not anomalies, so silent by default).
const ROUTER_DEBUG = process.env.CB_ROUTER_DEBUG === "1";

const AGENT_BROWSER_BIN = path.join(REPO_ROOT, "node_modules", "agent-browser", "bin", "agent-browser.js");

// The /dev/ space: a place the *dev-repo agent* (Claude Code, not a box) builds
// things for you to view in the browser — HTML visualizations, rendered
// Markdown reports, data displays. Served from the tracked dev/ directory
// (committed, unlike the gitignored scratch/), so these views are kept.
const DEV_ROOT = path.join(REPO_ROOT, "dev");
void DEV_ROOT; // referenced in docs/comments only; kept as a named landmark.

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

async function resolveWorktree(name: string): Promise<ResolvedWorktree | null> {
  if (name === "main") {
    return {
      name: "main",
      root: MAIN_ROOT,
      backendCwd: path.join(MAIN_ROOT, "callback-box"),
      frontendCwd: path.join(MAIN_ROOT, "callback-box", "src", "frontend"),
      boxes: (await readBoxes(path.join(MAIN_ROOT, "callback-box", ".env"))) ?? MAIN_BOX_DEFAULTS,
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

/**
 * Generate this worktree's `hub.json`, written fresh on every (re)start
 * (single-slot per worktree, like the pidfile) so a `BOXES=` edit in the
 * worktree's `.env` or a resolved-slug change always takes effect on the
 * next cold start. `port` is the worktree's own dynamically-assigned
 * `backendPort` — Vite's `vite.config.ts` proxies `/<box>/api/...` etc. to
 * `http://localhost:BACKEND_PORT`, and the hub's own routing composes with
 * that unchanged. `lazy: true` + `idleMs: IDLE_TIMEOUT_MS` give each BOX the
 * same lazy-start/idle-collect semantics this router gives each WORKTREE.
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

// --- PID file management ----------------------------------------------

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return errnoCode(e) === "EPERM";
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
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }
    }
    if (typeof data.socketDir === "string") {
      try {
        const dashPidStr = await fs.readFile(path.join(data.socketDir, "dashboard.pid"), "utf8");
        const dashPid = Number.parseInt(dashPidStr.trim(), 10);
        if (Number.isFinite(dashPid) && pidAlive(dashPid)) {
          log(`sweep: killing leftover dashboard pid ${dashPid} from ${file}`);
          try {
            process.kill(dashPid, "SIGTERM");
          } catch {
            /* gone */
          }
        }
      } catch {
        /* no dashboard pidfile, fine */
      }
    }
    await fs.unlink(fullPath).catch(() => {});
  }
}

// --- Process supervision effects --------------------------------------
//
// The worktree lifecycle model lives in ./router-lifecycle.ts; the engine that
// drives it lives in ./router-core.ts. THIS section holds the REAL effect
// implementations the engine is injected with — the actual spawning, killing,
// HTTP probes, timers, and clock.

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
  throw new Error(`${label} did not respond to HTTP GET ${reqPath} within ${timeoutMs}ms`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Build the real effects the router core runs on. Constructed in `main()` (not
 * at module scope) so importing this file is side-effect-free — no timers, no
 * pidfile-store map, no port allocation happen until the router is actually run.
 */
function createRealEffects(): RouterEffects {
  const pidStore = createPidStore(PID_DIR);
  return {
    spawn: (command, args, options) => execa(command, args, options),
    killGroup,
    pidAlive,
    waitForHttp,
    setTimer: (ms, fn): TimerHandle => {
      const t = setTimeout(() => {
        try {
          fn();
        } catch (err) {
          // A throwing escalation/idle callback must never crash the router.
          console.error(`[router] timer callback threw: ${errMessage(err)}`);
        }
      }, ms);
      // Escalation and idle timers must not keep the process alive on their own.
      t.unref();
      return { cancel: () => clearTimeout(t) };
    },
    clearTimer: (handle) => handle.cancel(),
    now: () => Date.now(),
    sleep,
    pidStore,
    writeHubConfig: writeWorktreeHubConfig,
    getPort: () => getPort(),
    resolveWorktree,
    resolveBoxEntries,
  };
}

// --- HTTP proxy --------------------------------------------------------
//
// The proxy + its retry/body-replay machinery is a REQUEST-level concern, kept
// deliberately OUT of the lifecycle state machine (bin/docs/router-protocol.md,
// "Fifth candidate that stays OUT of the state machine"). It touches the core
// only through the `ensureRunning` handshake every request performs.

const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

/**
 * Socket errors that mean "the peer went away", not "the router is broken".
 * A client abandoning a request is routine during a worktree cold start, and a
 * dev router must not die of it — these are logged-and-ignored everywhere they
 * surface, including the process-level uncaughtException backstop.
 */
function isBenignSocketError(err: NodeJS.ErrnoException | undefined): boolean {
  if (!err) return false;
  return err.code === "ECONNRESET" || err.code === "EPIPE" || err.code === "ECONNABORTED";
}

proxy.on("error", (err: Error, _req, res) => {
  log(`proxy error: ${err.message}`);
  if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
    const r = res as http.ServerResponse;
    r.writeHead(502, { "content-type": "text/plain" });
    r.end(`Bad gateway: ${err.message}\n`);
  } else if (res) {
    try {
      (res as http.ServerResponse | Socket).end();
    } catch {
      /* gone */
    }
  }
});

/**
 * The `/<worktree>/<box>` box slug of a proxied request, or null when the path
 * has no box segment (`/<w>/`, `/<w>/api/...`, `/<w>/@vite/...`). Used only to
 * scope the Set-Cookie Path rewrite; the rewrite's own exact-`/<slug>` match is
 * the real guard, so a non-box second segment here is harmless (it never equals
 * a box cookie's Path).
 */
function boxSlugOf(reqPath: string): string | null {
  const m = reqPath.match(/^\/[^/?#]+\/([^/?#]+)(?:[/?#]|$)/);
  return m ? m[1]! : null;
}

// The box child sets `cb_mobile` with `Path=/<slug>` (it only knows its slug);
// behind the router the browser path is `/<worktree>/<slug>/…`, so the cookie is
// dropped on reload + the tRPC WebSocket unless the router rewrites its Path.
// `proxyRes` fires BEFORE http-proxy-3's writeHeaders pass copies proxyRes.headers
// onto the client response (web-incoming.ts: emit `proxyRes` → run web-outgoing
// passes), so mutating `proxyRes.headers["set-cookie"]` here is the correct hook.
// Shared by the TCP and UDS servers (both proxy through this one instance); the
// rewrite is a no-op for the CLI's UDS traffic and correct for browser traffic.
proxy.on("proxyRes", (proxyRes, req) => {
  const reqPath = req.url ?? "";
  const worktree = parseWorktreeName(reqPath);
  const boxSlug = worktree ? boxSlugOf(reqPath) : null;
  if (!worktree || !boxSlug) return;
  const rewritten = rewriteMobileCookiePath(proxyRes.headers["set-cookie"], { worktree, boxSlug });
  if (rewritten !== undefined) proxyRes.headers["set-cookie"] = rewritten;
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

// The spoof wall (expose-dev-router B.2c / finding: strip client `x-cb-*`).
// The router injects exactly ONE trusted `x-cb-*` header — `x-cb-base-prefix`
// (via injectBasePrefix). Every other `x-cb-*` (x-cb-authenticated-email,
// x-cb-hub-secret, x-cb-hub-auth, x-cb-diag, …) is an identity/authorization
// header the worktree hub or box trusts; a client on the exposed TCP listener
// must never be able to forge one and have it reach Vite/the hub. So we delete
// ALL incoming `x-cb-*` at the router edge before proxying (mirrors the hub's
// own `stripHubHeaders`). `injectBasePrefix` then re-sets the one the router
// legitimately owns. Defense-in-depth: the hub strips again downstream.
const CB_HEADER_PREFIX = "x-cb-";
function stripClientCbHeaders(headers: http.IncomingHttpHeaders): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith(CB_HEADER_PREFIX)) delete headers[key];
  }
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
    const options = body === null ? { target } : { target, buffer: Readable.from(body) };
    proxy.web(req, res, options, (err: Error & { code?: string } | undefined) => resolve(err));
  });
}

async function proxyWithRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  name: string,
  retriesLeft: number,
  core: RouterCore,
  mobileBootstrap: MobileBootstrapTarget | null,
): Promise<void> {
  const bodyLength = replayableBodyLength(req);
  const body = bodyLength === null ? null : await readBody(req);
  // Strip ALL client-supplied `x-cb-*` first (the spoof wall), so a forged
  // identity/hub-secret header can never reach the worktree. Then inject the one
  // header the router legitimately owns: `x-cb-base-prefix`, telling the fronted
  // worktree which path prefix this router strips so its login redirects (and
  // SPA asset rewrite) can rebuild the full browser path. injectBasePrefix also
  // strips any client copy of that one header before setting it (Track A).
  stripClientCbHeaders(req.headers);
  injectBasePrefix(req.headers, `/${name}`);
  let bootstrapPending = mobileBootstrap;
  for (;;) {
    let handle: WorktreeHandle;
    try {
      // Re-resolve every attempt: after a kill/restart race the worktree's
      // new generation listens on different ports, so retrying the original
      // target would hammer a dead port. ensureRunning also restarts a
      // worktree that died between request arrival and proxying — the HTTP
      // request already established user intent.
      handle = await core.ensureRunning(name);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(httpStatusOf(err) ?? 502, { "content-type": "text/plain" });
        res.end(`Failed to start worktree ${name}: ${errMessage(err)}\n`);
      }
      return;
    }
    // A start that was superseded mid-flight (invariant #5) resolves to a
    // non-ready handle; treat it like a transient upstream and retry, which
    // re-runs ensureRunning against the fresh generation (or cold-starts one).
    const ready = readyLifecycle(handle);
    let err: (Error & { code?: string }) | undefined;
    if (ready) {
      if (bootstrapPending) {
        const target = bootstrapPending;
        bootstrapPending = null;
        try {
          const cookies = await bootstrapMobileSessionCookie({
            ...target,
            backendPort: ready.backendPort,
          });
          if (!cookies) {
            res.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
            res.end("Mobile session bootstrap failed.\n");
            return;
          }
          res.setHeader("set-cookie", cookies);
        } catch (error) {
          log(`[${name}] mobile session bootstrap failed: ${errMessage(error)}`);
          res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
          res.end("Mobile session bootstrap failed.\n");
          return;
        }
      }
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
      try {
        res.end();
      } catch {
        /* already ended */
      }
    }
    return;
  }
}

// --- Presentation: index page, status, failed page ---------------------

function parseWorktreeName(reqPath: string): string | null {
  const m = reqPath.match(/^\/([^/?#]+)(?:[/?#]|$)/);
  return m ? m[1]! : null;
}

interface DiscoveredWorktree {
  name: string;
  running: boolean;
  handle?: WorktreeHandle;
}

async function discoverWorktrees(core: RouterCore): Promise<DiscoveredWorktree[]> {
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
  for (const [name, handle] of core.entries()) {
    const existing = all.get(name) ?? { name, running: false };
    all.set(name, { ...existing, running: isServing(handle), handle });
  }
  return Array.from(all.values()).sort((a, b) =>
    a.name === "main" ? -1 : b.name === "main" ? 1 : a.name.localeCompare(b.name),
  );
}

// Best-effort "+ins −del vs main" for the worktree list. Uses the merge-base so
// a worktree that hasn't merged a newer main doesn't count main's own commits as
// deletions; diffs the WORKING TREE (committed + uncommitted) against it, so the
// number reflects the tree's current state. Null on any error or no changes.
async function worktreeDiffStat(name: string): Promise<{ ins: number; del: number } | null> {
  if (name === "main") return null;
  try {
    const cwd = worktreeRoot(name);
    const base = (await execa("git", ["merge-base", "main", "HEAD"], { cwd })).stdout.trim();
    if (!base) return null;
    const { stdout } = await execa("git", ["diff", "--shortstat", base], { cwd });
    const ins = Number(/(\d+) insertion/.exec(stdout)?.[1] ?? "0");
    const del = Number(/(\d+) deletion/.exec(stdout)?.[1] ?? "0");
    return ins === 0 && del === 0 ? null : { ins, del };
  } catch (_e) {
    return null; // best-effort: a non-git worktree or transient git error → no stat
  }
}

async function renderIndex(core: RouterCore): Promise<string> {
  const list = await discoverWorktrees(core);
  const diffStats = new Map(
    await Promise.all(list.map(async (w) => [w.name, await worktreeDiffStat(w.name)] as const)),
  );
  const rows = list
    .map((w) => {
      const ready = w.handle ? readyLifecycle(w.handle) : null;
      const status =
        w.handle && failedLifecycle(w.handle)
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
      const diff = diffStats.get(w.name) ?? null;
      const diffCell = diff
        ? `<span class="diffstat" title="changes vs main (committed + uncommitted, since this tree branched)"><span class="ins">+${diff.ins}</span> <span class="del">−${diff.del}</span></span>`
        : `<span class="diffstat"></span>`;
      return `
      <li>
        <a href="/${escapeHtml(w.name)}/" class="name">${escapeHtml(w.name)}</a>
        <span class="statuscell">${status}</span>
        ${diffCell}
        <div class="actions">${dashLink}${devLink}${stopForm}</div>
      </li>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>callback-box dev router</title>
<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAADCUlEQVR4nOyazWsTQRjG3+xOPpsQsa21pAcpeGipIAUp1YNi8aJ4EL17Ebz6J/RP8CoI4kkFxZN6qjcpIhTFYhFBPDRKbCMN+f7Yxic72+lm89F8707Z3yGZTWbmfZ53JzNDdli1WqUWpOKFve185m8xnypXCvs0WlhACUa94VP+EzPBaCzQqpqnqYHEVvrPZrqQKpMzCES90wuRqblI41dWA9nd0q/1f+lEkZxHZMp/Zvnk2ITP/GGdgeTP7I/3u+Rszl6dGJ8dE5dMlKRQD7hI4UHhbxg5UqjnQCoE87JhAOOepEIIrhnAnOPMX20bIBiyiRvAjEkSwmUzrFbOme+7ArIhnmGtJWmBeIadAkkLxLO8nOOHA/Fs9Lu0AQLxzHwdYlt4nfS/OvxE/cYLOW3eKFTmeCGrzYtyn/C4YEwPl22I1QbPlyfvuGihtVtyB052irc7byWSdWRcnjseQnjjoLln78VFGig5052x5NJ8h3vOl4XBGxgxCkmOa8BuXAN24xqwG9eA3bgG7KZuO72pzhgFFrPUW6jEa6/aNg0BEbeHEIw3fuZf0juKtaxo+kNyQYuf08PAVQ+WOox4ZBT0g048l98+p74xB6NmWUQw3NWvuvR2aeog0EGHRieDMWAj7ixkN64Bu3EN2I1rwG5cA3ZzvLbTaj5sFHJ1D/W1kPEQTQtmaDhYQncekfGW3uS0mgu3quRNnjZfaqHMvt4vwvRsScTVRYc7jEgmb7y55/rD79Q3jQGaGoNoJFjRpbfJV1cwGgRQIwRZkjds3FnIbo6BAVXix6wQr/i8OZIWiFemglKe9OBAvLIc85O0QLxyd+WS6pNyFEE2xNdmocXJJEkIl22cWrz16FOpECV58AVSr+9fILEO3DuvklQIwYaBG0uL12Z/kyRAKgTz8uFK/ODmFSk8QCSkikvr0eM3Hzcef9ac+XvAuMfIEbnnND/8vfpybWNnXCuFyBlgxsScs3pnpfErT5vj90/XPqzHi4l8pFQOkealEaOWsVPAWovVCvN9q1r/AQAA//+5h+wYAAAABklEQVQDANbzYY8DPoT1AAAAAElFTkSuQmCC">
<style>
  body { font: 14px/1.5 system-ui, sans-serif; max-width: 900px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { font-size: 1.2em; margin-bottom: 0.2em; }
  p.sub { color: #666; margin-top: 0; }
  ul { list-style: none; padding: 0; }
  li { display: grid; grid-template-columns: max-content max-content 1fr auto; align-items: center; column-gap: 0.9em; padding: 0.5em 0; border-bottom: 1px solid #eee; }
  a.name { font-weight: 600; text-decoration: none; color: #2255aa; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
  a.name:hover { text-decoration: underline; }
  .statuscell { white-space: nowrap; }
  .diffstat { justify-self: end; white-space: nowrap; font-size: 0.8em; font-family: ui-monospace, Menlo, monospace; }
  .diffstat .ins { color: #2a8a2a; }
  .diffstat .del { color: #c0392b; }
  .actions { display: flex; align-items: center; gap: 0.6em; justify-self: end; }
  .badge { font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 4px; }
  .badge.running { background: #d8f0d8; color: #2a6b2a; }
  .badge.cold    { background: #ececec; color: #666; }
  .badge.failed  { background: #ffe1e1; color: #a22; }
  .badge.failed a { color: #a22; text-decoration: underline; }
  .dash { font-size: 0.8em; color: #2255aa; text-decoration: none; padding: 0.15em 0.5em; border: 1px solid #d0deef; border-radius: 4px; background: #f4f8ff; }
  .dash:hover { background: #e6f0ff; text-decoration: underline; }
  .stopForm { display: inline-flex; }
  .stopForm button { font-size: 0.75em; padding: 0.15em 0.6em; background: #fff; border: 1px solid #ddd; border-radius: 4px; color: #666; cursor: pointer; }
  .stopForm button:hover { background: #fee; border-color: #faa; color: #a22; }
  .help { margin-top: 2em; padding: 1em; background: #f7f7f7; border-radius: 6px; font-size: 0.9em; }
  .help h2 { margin: 0 0 0.4em; font-size: 1em; }
  .help code { background: #fff; padding: 0.1em 0.35em; border-radius: 3px; border: 1px solid #ddd; }
  footer { margin-top: 1em; font-size: 0.85em; color: #888; }
  footer a { color: #888; }
  @media (max-width: 700px) {
    li { display: flex; flex-wrap: wrap; gap: 0.3em 0.7em; }
    a.name { white-space: normal; }
    .diffstat, .actions { justify-self: auto; }
  }
</style>
</head>
<body>
<h1>callback-box dev router</h1>
<p class="sub">Click a worktree to open it. Cold worktrees start on first request (~4s); running ones idle-shut-down after ${Math.round(IDLE_TIMEOUT_MS / 1000)}s. <strong>dev ↗</strong> opens that worktree's visualizations &amp; doc browser (served from disk, no start).</p>
<p><a href="/workstreams/" class="dash" title="Browse workstreams and the issue queue">workstreams ↗</a></p>
<ul>${rows}</ul>

<div class="help">
  <h2>If something looks wedged</h2>
  <p>
    Run <code>bin/workstreams panic</code> from a terminal — this kills the
    router plus every child it knows about, wipes <code>~/.cache/callback-box</code>
    state, and frees port ${ROUTER_PORT}. Then start fresh with <code>pnpm dev</code>.
  </p>
  <p>
    Per-worktree logs are at <code>~/.cache/callback-box/logs/&lt;name&gt;.log</code>.
  </p>
  <h2>If the list is too long</h2>
  <p>
    Run <code>bin/workstreams sweep</code> to remove worktrees that are fully
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
<meta name="viewport" content="width=device-width, initial-scale=1">
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

// Per-worktree, just like the box apps: /<name>/dev/ serves <name>'s checkout —
// its tracked dev/ directory (artifacts) and a markdown doc browser over its own
// .md files. Served straight from disk, so it never cold-starts the worktree.
function worktreeRoot(name: string): string {
  return name === "main" ? MAIN_ROOT : path.join(WORKTREES_ROOT, name);
}

// --- Auth gate: deny handling -----------------------------------------

/**
 * The worktree segment to route a login redirect through. Login lives under a
 * worktree (`/<w>/auth/login`), so a bare router-infra path (`/`, `/dev`,
 * `/__router/*`) has none — fall back to `main`. A box or `/<w>/dev/` path
 * carries its own worktree in the first segment.
 */
function loginWorktree(url: string): string {
  const first = parseWorktreeName(url);
  if (!first || first === "dev" || first === "__router") return "main";
  return first;
}

/**
 * Write the response for a denied (non-`trustedLocal`) request. A denied browser
 * NAVIGATION (302 → the prefixed login page, carrying `returnTo`) so the user can
 * log in and come back; everything else gets a small JSON body at the gate's
 * status (401 / 403 / 404). Nothing here cold-starts or serves — the deny is
 * terminal, upstream of all dispatch.
 */
export function writeDeny(req: http.IncomingMessage, res: http.ServerResponse, decision: RouterAuthDecision & { allow: false }): void {
  const url = req.url || "/";
  // Self-identify as a GUARDED dev router on denials of our own `/__router/*`
  // control routes (Track C, expose-dev-router.md): a benign marker so
  // `cb tailscale setup` can prove the gate is live end-to-end over Serve
  // (401 + this header) and distinguish us from an ungated router (200, no
  // header) or a non-router. Leaks nothing a bare curl doesn't already learn.
  const guardHeaders = routerGuardHeaders(url);
  if (decision.redirectToLogin) {
    const location = `/${loginWorktree(url)}/auth/login?returnTo=${encodeURIComponent(url)}`;
    res.writeHead(302, { location, ...guardHeaders });
    res.end();
    return;
  }
  res.writeHead(decision.status, { "content-type": "application/json; charset=utf-8", ...guardHeaders });
  res.end(`${JSON.stringify({ error: decision.reason })}\n`);
}

/** The `x-cb-router-guarded: 1` marker for a denial of a `/__router/*` control
 *  route, else no extra headers. Pure over the request path so it is unit-tested
 *  directly (bin/router-guard-header.test.ts). */
export function routerGuardHeaders(url: string): Record<string, string> {
  const q = url.indexOf("?");
  const pathname = q === -1 ? url : url.slice(0, q);
  return pathname === "/__router" || pathname.startsWith("/__router/") ? { "x-cb-router-guarded": "1" } : {};
}

// --- HTTP + WebSocket server ------------------------------------------

/**
 * Build one HTTP+WS server bound to the SINGLE auth gate. `trustedLocal` is a
 * compile-time constant of the server instance — true for the UDS server, false
 * for the TCP one — never derived from a header or `req.socket.remoteAddress`
 * (Tailscale Serve re-dials loopback, so a 127.0.0.1 TCP peer is NOT local). A
 * connection can only reach the handler of the server it landed on, so which
 * listener accepted it is the whole story.
 */
function createRouterServer(core: RouterCore, gate: { authDeps: RouterAuthDeps; trustedLocal: boolean }): http.Server {
  const { authDeps, trustedLocal } = gate;
  const refusedUpgradeLogAt = new Map<string, number>();

  // The per-request dispatch. Wrapped below in a `.catch` rejection boundary so
  // NO thrown/rejected error from any path (auth gate, dev-serving, proxy,
  // cold-start) can escape to an unhandledRejection and crash the SHARED router
  // — it becomes a 500 for that one request instead (expose-dev-router B.2c /
  // finding 3, DoS boundary). The auth gate and the /dev decode have their own
  // narrower guards (a 403/400); this is the outermost backstop for the rest.
  const requestListener = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // A client that hangs up mid-request (tab closed, navigated away, gave up
    // waiting on a ~4s worktree cold start) makes node's abortIncoming emit
    // ECONNRESET on the request. With no listener here it escapes to the
    // process-level uncaughtException handler, which used to take the whole
    // shared router down — one abandoned request killing every worktree's dev
    // server. Absorb it at the socket it belongs to; there is nothing to do
    // but stop writing.
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (!isBenignSocketError(err)) log(`request error: ${err.message}`);
    });
    res.on("error", (err: NodeJS.ErrnoException) => {
      if (!isBenignSocketError(err)) log(`response error: ${err.message}`);
    });

    const url = req.url || "/";

    // THE single chokepoint. Runs BEFORE all routing/proxy/cold-start/dev-serving
    // — nothing below executes for a denied request. UDS arrivals (trustedLocal)
    // bypass every resolver; TCP arrivals authenticate with current code.
    let decision: RouterAuthDecision;
    try {
      decision = await authorizeRouterRequest(
        { trustedLocal, method: req.method || "GET", url, headers: req.headers },
        authDeps,
      );
    } catch (err) {
      // A resolver threw (e.g. a filesystem fault). Fail CLOSED — never fall
      // through to dispatch on an unresolved auth decision.
      log(`auth gate error for ${url}: ${errMessage(err)}`);
      res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify({ error: "auth-gate-error" })}\n`);
      return;
    }
    if (!decision.allow) {
      writeDeny(req, res, decision);
      return;
    }

    if (url === "/__router/status" || url === "/__router/status/") {
      res.writeHead(200, { "content-type": "application/json" });
      // Disk-discovery first so cold worktrees (not yet hit by a request) still
      // appear in the status response — otherwise the JSON looks empty when a
      // freshly-created worktree exists but hasn't been warmed yet.
      const discovered = await discoverWorktrees(core);
      const state: Record<string, unknown> = {};
      for (const w of discovered) {
        const handle = core.getHandle(w.name);
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
          { routerPort: ROUTER_PORT, routerPid: process.pid, idleTimeoutMs: IDLE_TIMEOUT_MS, worktrees: state },
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
      // POST-only — a GET probe (e.g. a curl with no -X) shouldn't have a side
      // effect. The failure page's retry button POSTs.
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
        res.end("retry requires POST\n");
        return;
      }
      // Clear any failed-state entry so ensureRunning will spawn a fresh attempt
      // rather than re-throwing the cached error.
      core.clearFailed(name);
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
      await core.stopWorktree(name);
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
        handle = await core.ensureRunning(name);
      } catch (err) {
        res.writeHead(httpStatusOf(err) ?? 502, { "content-type": "text/plain" });
        res.end(`Failed to start worktree ${name}: ${errMessage(err)}\n`);
        return;
      }
      const dashboardUrl = readyLifecycle(handle)?.dashboardUrl ?? null;
      if (!dashboardUrl) {
        res.writeHead(502, { "content-type": "text/plain" });
        res.end(
          `Worktree ${name} is running but its dashboard failed to start. See logs at ~/.cache/callback-box/logs/${name}.log\n`,
        );
        return;
      }
      res.writeHead(302, { location: dashboardUrl });
      res.end();
      return;
    }

    if (url === "/" || url === "") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await renderIndex(core));
      return;
    }

    const requestPathname = url.split("?")[0] ?? url;
    if (requestPathname === "/workstreams" || requestPathname.startsWith("/workstreams/")) {
      const requestUrl = new URL(url, "http://router.local");
      await serveWorkstreams({
        method: req.method || "GET",
        pathname: requestPathname,
        repoRoot: REPO_ROOT,
        mainRoot: MAIN_ROOT,
        worktreesRoot: WORKTREES_ROOT,
        res,
        flash: requestUrl.searchParams.get("flash") ?? "",
        query: requestUrl.searchParams.toString(),
      });
      return;
    }

    if (url === "/favicon.png" || url === "/favicon.ico") {
      try {
        const buf = await fs.readFile(path.join(REPO_ROOT, "bin", "assets", "favicon.png"));
        res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
        res.end(buf);
      } catch (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`favicon not found: ${errMessage(err)}\n`);
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
    const issuesRedirect = legacyIssuesRedirect(afterName);
    if (issuesRedirect) {
      res.writeHead(301, { location: issuesRedirect });
      res.end();
      return;
    }
    if (afterName.split("?")[0] === "/dev") {
      res.writeHead(301, { location: `/${name}/dev/` });
      res.end();
      return;
    }
    // POST /<name>/dev/story-eval/save — autosave the review app's verdicts to a
    // fixed working file on disk. Must precede the generic /dev/ disk-serve below
    // (which only handles GET reads). Never cold-starts the worktree.
    if (afterName.split("?")[0] === "/dev/story-eval/save") {
      await serveStoryEvalSave({ req, res, repoRoot: worktreeRoot(name) });
      return;
    }
    if (afterName.startsWith("/dev/")) {
      await serveDev({ name, rest: afterName, res, repoRoot: worktreeRoot(name) });
      return;
    }

    // /<name>/site/... — the generated static site (site/dist/), served from
    // disk so it never cold-starts the worktree.
    if (afterName.split("?")[0] === "/site") {
      res.writeHead(301, { location: `/${name}/site/` });
      res.end();
      return;
    }
    if (afterName.startsWith("/site/")) {
      await serveSite({ name, rest: afterName, res, repoRoot: worktreeRoot(name) });
      return;
    }

    try {
      await core.ensureRunning(name);
    } catch (err) {
      const status = httpStatusOf(err) ?? 502;
      // If we have a captured failure for this worktree, render the rich HTML
      // error page (stderr tail + retry button). Otherwise fall back to plain
      // text (e.g. 404 for unknown worktree name).
      const failedHandle = core.getHandle(name);
      const failed = failedHandle ? failedLifecycle(failedHandle) : null;
      if (failed) {
        res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
        res.end(renderFailedPage(name, failed.lastError));
        return;
      }
      res.writeHead(status, { "content-type": "text/plain" });
      res.end(`Failed to start worktree ${name}: ${errMessage(err)}\n`);
      return;
    }

    await proxyWithRetry(req, res, name, 5, core, mobileBootstrapTarget(req, decision));
  };

  const server = http.createServer((req, res) => {
    void requestListener(req, res).catch((err: unknown) => {
      log(`unhandled request error for ${req.url ?? "?"}: ${errMessage(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(`${JSON.stringify({ error: "internal-router-error" })}\n`);
      } else {
        try {
          res.end();
        } catch {
          /* response already torn down */
        }
      }
    });
  });

  // WebSocket upgrades never cold-start a worktree. Clients auto-reconnect on
  // timers (tRPC's wsLink retries forever, first attempt with zero delay), so
  // treating an upgrade as user activity would resurrect an idle-shutdown
  // worktree from any abandoned background tab, forever. Refusal is cheap for
  // the client (it just backs off and retries); the worktree comes back when a
  // real HTTP request arrives — a page load, an API call, or Vite's HMR ping.
  server.on("upgrade", async (req, socket, head) => {
    const reqUrl = req.url || "/";
    // WS must authenticate too (2nd-review 2.7): the same chokepoint runs on the
    // upgrade. A denied upgrade destroys the socket. Over TCP a browser's cookie
    // rides the upgrade headers; over UDS trustedLocal bypasses the resolvers.
    let decision: RouterAuthDecision;
    try {
      decision = await authorizeRouterRequest(
        { trustedLocal, method: req.method || "GET", url: reqUrl, headers: req.headers },
        authDeps,
      );
    } catch (err) {
      log(`auth gate error on WS upgrade for ${reqUrl}: ${errMessage(err)}`);
      socket.destroy();
      return;
    }
    if (!decision.allow) {
      socket.destroy();
      return;
    }
    // The spoof wall on the upgrade path too: strip client `x-cb-*` before the
    // socket is proxied to Vite/the hub (expose-dev-router B.2c). The WS carries
    // the browser session on TCP; it needs no router-injected `x-cb-*`, so this
    // is a pure strip with no re-injection.
    stripClientCbHeaders(req.headers);
    const name = parseWorktreeName(reqUrl);
    if (!name) {
      socket.destroy();
      return;
    }
    let handle = core.getHandle(name);
    const inFlight = handle ? startPromiseOf(handle) : null;
    if (inFlight) {
      // A cold start is already underway (triggered by an HTTP request) — let
      // the socket wait for it rather than refusing and forcing a retry cycle.
      try {
        handle = await inFlight;
      } catch (err) {
        log(`[${name}] upgrade failed: ${errMessage(err)}`);
        socket.destroy();
        return;
      }
    }
    const ready = handle ? readyLifecycle(handle) : null;
    if (!handle || !ready) {
      if (ROUTER_DEBUG) {
        const last = refusedUpgradeLogAt.get(name) ?? 0;
        if (Date.now() - last > 60_000) {
          refusedUpgradeLogAt.set(name, Date.now());
          log(`[${name}] refusing WS upgrade while not running (logged at most once/min)`);
        }
      }
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    core.touch(handle);
    const target = `http://127.0.0.1:${ready.frontendPort}`;
    proxy.ws(req, socket, head, { target }, (err: Error | undefined) => {
      if (err) {
        log(`[${name}] ws proxy error: ${err.message}`);
        try {
          socket.destroy();
        } catch {
          /* already gone */
        }
      }
    });
  });

  return server;
}

// --- Router PID file ---------------------------------------------------

async function acquireRouterPidFile(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    const existing = await fs.readFile(ROUTER_PID_FILE, "utf8");
    const pid = Number(existing.trim());
    if (pid && pidAlive(pid)) {
      throw new Error(`Another router is already running (pid ${pid}). Run \`bin/workstreams panic\` to clear.`);
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      if (e instanceof Error && e.message.startsWith("Another router")) throw e;
      // Otherwise the file is malformed; overwrite it.
    }
  }
  await fs.writeFile(ROUTER_PID_FILE, String(process.pid));
}

// --- Unix-domain-socket listener (the trusted-local channel) ----------

/**
 * Bind the UDS listener. Unlinks any stale socket first (a crashed prior router
 * leaves the file behind), then `chmod 0600` so only this user can connect —
 * the socket file IS the local capability. Rejects if the bind fails for a
 * reason other than a stale file we already cleared.
 */
async function listenUnixSocket(server: http.Server, sockPath: string): Promise<void> {
  await fs.mkdir(path.dirname(sockPath), { recursive: true });
  await fs.unlink(sockPath).catch(() => {}); // remove a stale socket from a dead router
  await new Promise<void>((resolve, reject) => {
    const onError = (err: unknown): void => reject(err instanceof Error ? err : new Error(String(err)));
    server.once("error", onError);
    server.listen(sockPath, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  await fs.chmod(sockPath, 0o600);
}

// --- Logging + terminal tab title -------------------------------------

function log(msg: string): void {
  console.log(`[router ${new Date().toISOString()}] ${msg}`);
}

function setTabTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]0;${title}\x07`);
}

function updateTabTitle(core: RouterCore): void {
  const running = core.entries().map(([, h]) => h).filter((h) => isServing(h));
  let title = `⚡ cb router :${ROUTER_PORT}`;
  if (running.length === 1) {
    title += ` · ${running[0]!.name}`;
  } else if (running.length > 1) {
    title += ` · ${running.length} worktrees`;
  }
  setTabTitle(title);
}

// --- Boot + shutdown (main-only; not run on import) --------------------

async function main(): Promise<void> {
  // The router must NEVER be in hub mode (expose-dev-router B.2c / finding 3.3).
  // Its owner-session resolver runs through resolveRequestIdentity, whose branch
  // is env-driven by CB_HUB_SECRET (auth.ts isHubMode): were it set in the
  // router's env, the resolver would take the hub-header identity path instead
  // of the gen-aware cookie path. The deps already fail closed (they accept only
  // source==="cookie"), but we harden by removing the env var outright.
  //
  // Safe for the child hubs it spawns: verified that `cb hub` MINTS its own
  // per-boot secret (crypto.randomBytes, cli/commands/hub.ts) and never reads
  // CB_HUB_SECRET from its inherited env; its Supervisor then sets each
  // `cb serve` child's CB_HUB_SECRET explicitly from that minted secret
  // (hub/supervisor.ts buildChildEnv). So the router's env copy is unused by
  // any descendant — deleting it changes nothing downstream.
  delete process.env.CB_HUB_SECRET;

  // The router's OWN gate reads CB_BROWSE_API_KEY (via core/browse-key.ts), so
  // the router process needs it too — the per-checkout copy in `childEnv` only
  // reaches the children it spawns. Load it from the main checkout's `.env`,
  // the file this router already treats as its config (MAIN_BOX_DEFAULTS above).
  //
  // This makes the browse key effectively MACHINE-level, not per-worktree: one
  // router process fronts every worktree, so its gate has exactly one key to
  // compare against. Worktree copies of `.env` still matter — the hub and box
  // children verify independently and are spawned per worktree — but a worktree
  // that sets a DIFFERENT key would pass its own children and be refused at the
  // router. One key everywhere is the supported shape.
  //
  // Only fills in what isn't already exported, so `CB_BROWSE_API_KEY=… pnpm dev`
  // still wins.
  //
  // The ROUTER takes only the one key it needs, not the whole file — unlike the
  // children, which get the file wholesale because that is what a dotenv is
  // for. The router is different: it is the authenticating front door, and its
  // own resolver is env-driven in ways a dev config file must not reach. A
  // `CB_HUB_SECRET=` line would flip `isHubMode()` and swing the resolver off
  // the gen-aware cookie path that the `delete` above exists to guarantee —
  // silently undoing that hardening from a gitignored file nobody reviews.
  // An allowlist makes that structurally impossible rather than relying on
  // nobody ever putting the wrong line in a `.env`.
  const ROUTER_ENV_FROM_FILE = ["CB_BROWSE_API_KEY"];
  const fileEnv = await readEnvFile(path.join(MAIN_ROOT, "callback-box", ".env"), log);
  for (const key of ROUTER_ENV_FROM_FILE) {
    const value = fileEnv[key];
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }

  const effects = createRealEffects();
  const core = createRouterCore(effects, {
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS,
    logDir: LOG_DIR,
    browseDir: BROWSE_DIR,
    agentBrowserBin: AGENT_BROWSER_BIN,
    devNoHub: DEV_NO_HUB,
    routerPid: process.pid,
    log,
    onStateChange: () => updateTabTitle(core),
  });
  // One auth gate, two listeners: the TCP server (Serve-fronted, must
  // authenticate) and the UDS server (trusted-local, unauthenticated). Both share
  // ONE handler-building function and ONE RouterAuthDeps — the only difference is
  // the `trustedLocal` flag baked into each server instance.
  const authDeps = createRouterAuthDeps({ resolveWorktree, resolveBoxEntries });
  const server = createRouterServer(core, { authDeps, trustedLocal: false });
  const localServer = createRouterServer(core, { authDeps, trustedLocal: true });

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`shutting down: ${reason}`);
    // Stop accepting new connections/requests FIRST, before tearing down
    // children below — otherwise a request arriving during stopAllChildren's
    // drain can still reach ensureRunning() and cold-start a fresh generation
    // after cleanup has already run for everything else.
    server.close();
    localServer.close();
    setTimeout(() => process.exit(0), KILL_GRACE_MS + 500).unref();
    await core.stopAllChildren();
    await fs.unlink(ROUTER_PID_FILE).catch(() => {});
    await fs.unlink(ROUTER_SOCK).catch(() => {});
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
    // Backstop for the per-request handlers in createRouterServer: a client
    // disconnect that reaches this far is still not a reason to kill a router
    // serving every worktree. Anything else is a real fault and still fatal —
    // a supervisor limping on in an unknown state is worse than restarting.
    if (isBenignSocketError(err)) {
      log(`ignoring benign socket error: ${err.code}`);
      return;
    }
    console.error("uncaughtException:", err);
    void shutdown("uncaughtException");
  });

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
    log(`startup reclaim failed (continuing): ${errMessage(err)}`);
  }
  await listenUnixSocket(localServer, ROUTER_SOCK);
  log(`trusted-local socket at ${ROUTER_SOCK} (mode 0600; unauthenticated, local CLI)`);
  listenLoopback(server, ROUTER_PORT, () => {
    log(`listening on http://localhost:${ROUTER_PORT}  (pid ${process.pid})`);
    log(`open http://localhost:${ROUTER_PORT}/main/ to dev the main checkout (root: ${MAIN_ROOT})`);
    log(`idle timeout: ${IDLE_TIMEOUT_MS}ms`);
    updateTabTitle(core);
  });
}

// Run the boot sequence only when executed directly (importing this module for
// its helpers must not bind ports or install signal handlers).
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(errMessage(err));
    process.exit(1);
  });
}
