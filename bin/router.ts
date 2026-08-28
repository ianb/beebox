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
// STRUCTURE (2026-07-11, Phase B of the state formalization; extended 2026-08-28
// when this file was split for size): the worktree lifecycle engine lives in
// ./router-core.ts (`createRouterCore(effects, config)`, owning the worktrees map
// and driving transitions through injected effects); the state model in
// ./router-lifecycle.ts; the serialized pidfile store in ./router-pidfile.ts; the
// REAL effects (execa, get-port, http.request probes) in ./router-real-effects.ts;
// the proxy and its retry/body-replay machinery in ./router-proxy.ts; the pages
// the router renders itself in ./router-pages.ts; the per-request dispatch in
// ./router-dispatch.ts and the WS upgrade in ./router-upgrade.ts; the shared
// configuration and logger in ./router-config.ts.
//
// THIS file wires those together into the two gated servers and runs the boot +
// signal-handler sequence in `main()`. Importing this module binds no ports and
// installs no signal handlers — only `main()` does, and it runs only when this
// file is executed directly.
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
import type { Duplex } from "node:stream";
import { reclaimOrphans } from "./process-cleanup.js";
import { authorizeRouterRequest, type RouterAuthDeps, type RouterAuthDecision } from "./router-auth.js";
import { createRouterAuthDeps } from "./router-auth-deps.js";
import { resolveBoxEntries } from "./box-entry.js";
import {
  createRealWorkstreamsAppEffects,
  createWorkstreamsAppSupervisor,
  type WorkstreamsAppSupervisor,
} from "./workstreams-app-supervisor.js";
import { isServing } from "./router-lifecycle.js";
import { createRouterCore, listenLoopback, type RouterCore } from "./router-core.js";
import { errMessage, errnoCode, readEnvFile } from "./router-effects.js";
import { createRealEffects, pidAlive, resolveWorktree, sweepStaleChildren } from "./router-real-effects.js";
import { isBenignSocketError } from "./router-proxy.js";
import { dispatchRouterRequest, type DispatchContext } from "./router-dispatch.js";
import { handleRouterUpgrade, type UpgradeState } from "./router-upgrade.js";
import {
  AGENT_BROWSER_BIN,
  BROWSE_DIR,
  DEV_NO_HUB,
  IDLE_TIMEOUT_MS,
  KILL_GRACE_MS,
  LOG_DIR,
  MAIN_ROOT,
  ROUTER_PID_FILE,
  ROUTER_PORT,
  ROUTER_SOCK,
  STATE_DIR,
  log,
  parseWorktreeName,
} from "./router-config.js";

// --- Auth gate: deny handling -----------------------------------------

/**
 * The worktree segment to route a login redirect through. Login lives under a
 * worktree (`/<w>/auth/login`), so a bare router-infra path (`/`, `/dev`,
 * `/__router/*`) has none — fall back to `main`. A box or `/<w>/dev/` path
 * carries its own worktree in the first segment.
 */
function loginWorktree(url: string): string {
  const first = parseWorktreeName(url);
  if (!first || first === "dev" || first === "__router" || first === "workstreams") return "main";
  return first;
}

/** The request field `writeDeny` reads. Structural so a unit test can pass a
 *  plain object instead of casting one to `http.IncomingMessage`. */
export interface DenyRequest {
  url?: string | undefined;
}

/** The response methods `writeDeny` writes through. Structural for the same
 *  reason; a real `http.ServerResponse` satisfies it. */
export interface DenyResponse {
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string): void;
}

/**
 * Write the response for a denied (non-`trustedLocal`) request. A denied browser
 * NAVIGATION (302 → the prefixed login page, carrying `returnTo`) so the user can
 * log in and come back; everything else gets a small JSON body at the gate's
 * status (401 / 403 / 404). Nothing here cold-starts or serves — the deny is
 * terminal, upstream of all dispatch.
 */
export function writeDeny(
  req: DenyRequest,
  { res, decision }: { res: DenyResponse; decision: RouterAuthDecision & { allow: false } },
): void {
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
export interface RouterServerGate {
  authDeps: RouterAuthDeps;
  trustedLocal: boolean;
  workstreamsApp?: {
    supervisor: WorkstreamsAppSupervisor;
    displayLogPath: string;
  };
}

export function createRouterServer(core: RouterCore, gate: RouterServerGate): http.Server {
  const { authDeps, trustedLocal, workstreamsApp } = gate;
  const ctx: DispatchContext = { core, workstreamsApp };
  const upgradeState: UpgradeState = { ctx, authDeps, trustedLocal, refusedUpgradeLogAt: new Map() };

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
      writeDeny(req, { res, decision });
      return;
    }

    await dispatchRouterRequest(ctx, { req, res, decision });
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
        } catch (_e) {
          /* response already torn down */
        }
      }
    });
  });

  // One rest parameter rather than (req, socket, head): the emitter fixes the
  // arity, and the house limit is two positional parameters.
  server.on("upgrade", (...upgradeArgs: [http.IncomingMessage, Duplex, Buffer]) => {
    const [req, socket, head] = upgradeArgs;
    void handleRouterUpgrade(upgradeState, { req, socket, head }).catch((err: unknown) => {
      log(`unhandled upgrade error for ${req.url ?? "?"}: ${errMessage(err)}`);
      socket.destroy();
    });
  });

  return server;
}

// --- Router PID file ---------------------------------------------------

/** A live pid in the router pidfile: a second router owns this state dir. */
class RouterAlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(`Another router is already running (pid ${pid}). Run \`bin/workstreams panic\` to clear.`);
    this.name = "RouterAlreadyRunningError";
  }
}

async function acquireRouterPidFile(): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    const existing = await fs.readFile(ROUTER_PID_FILE, "utf8");
    const pid = Number(existing.trim());
    if (pid && pidAlive(pid)) {
      throw new RouterAlreadyRunningError(pid);
    }
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") {
      if (e instanceof RouterAlreadyRunningError) throw e;
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

// --- Terminal tab title -----------------------------------------------

function setTabTitle(title: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\u001B]0;${title}\u0007`);
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
  const workstreamsAppLogPath = path.join(LOG_DIR, "workstreams-app.log");
  const workstreamsApp = createWorkstreamsAppSupervisor(
    createRealWorkstreamsAppEffects(STATE_DIR),
    {
      appRoot: path.join(MAIN_ROOT, "workstreams-app"),
      logPath: workstreamsAppLogPath,
      log,
      killGraceMs: KILL_GRACE_MS,
    },
  );
  const workstreamsAppGate = {
    supervisor: workstreamsApp,
    displayLogPath: workstreamsAppLogPath.startsWith(`${os.homedir()}${path.sep}`)
      ? `~${workstreamsAppLogPath.slice(os.homedir().length)}`
      : workstreamsAppLogPath,
  };
  const server = createRouterServer(core, {
    authDeps,
    trustedLocal: false,
    ...(workstreamsAppGate ? { workstreamsApp: workstreamsAppGate } : {}),
  });
  const localServer = createRouterServer(core, {
    authDeps,
    trustedLocal: true,
    ...(workstreamsAppGate ? { workstreamsApp: workstreamsAppGate } : {}),
  });

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
    await Promise.all([core.stopAllChildren(), workstreamsApp?.shutdown()]);
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
  if (workstreamsApp) {
    // Startup is intentionally not awaited: the authenticated fallback must be
    // reachable while dependencies are missing or the resident app is slow.
    void workstreamsApp.start();
  }
  await listenUnixSocket(localServer, ROUTER_SOCK);
  log(`trusted-local socket at ${ROUTER_SOCK} (mode 0600; unauthenticated, local CLI)`);
  listenLoopback(server, {
    port: ROUTER_PORT,
    onListening: () => {
      log(`listening on http://localhost:${ROUTER_PORT}  (pid ${process.pid})`);
      log(`open http://localhost:${ROUTER_PORT}/main/ to dev the main checkout (root: ${MAIN_ROOT})`);
      log(`idle timeout: ${IDLE_TIMEOUT_MS}ms`);
      updateTabTitle(core);
    },
  });
}

// Run the boot sequence only when executed directly (importing this module for
// its helpers must not bind ports or install signal handlers).
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(errMessage(err));
    process.exit(1);
  });
}
