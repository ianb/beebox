// The WebSocket upgrade path. Kept separate from the HTTP dispatch because its
// rules are different: an upgrade authenticates through the same gate but NEVER
// cold-starts a worktree. Clients auto-reconnect on timers (tRPC's wsLink
// retries forever, first attempt with zero delay), so treating an upgrade as
// user activity would resurrect an idle-stopped worktree from any abandoned
// background tab, forever. Refusal is cheap for the client (it backs off and
// retries); the worktree comes back when a real HTTP request arrives — a page
// load, an API call, or Vite's HMR ping.

import type http from "node:http";
import type { Duplex } from "node:stream";
import { authorizeRouterRequest, type RouterAuthDecision, type RouterAuthDeps } from "./router-auth.js";
import { readyLifecycle, startPromiseOf } from "./router-lifecycle.js";
import { proxy, prepareWorkstreamsAppHeaders, stripClientBbxHeaders } from "./router-proxy.js";
import { errMessage } from "./router-effects.js";
import { ROUTER_DEBUG, log, parseWorktreeName } from "./router-config.js";
import type { DispatchContext } from "./router-dispatch.js";

/** State the upgrade path keeps across requests: per-worktree log throttling. */
export interface UpgradeState {
  ctx: DispatchContext;
  authDeps: RouterAuthDeps;
  trustedLocal: boolean;
  /** Last time a refusal was logged for a worktree (at most one per minute). */
  refusedUpgradeLogAt: Map<string, number>;
}

export async function handleRouterUpgrade(
  state: UpgradeState,
  { req, socket, head }: { req: http.IncomingMessage; socket: Duplex; head: Buffer },
): Promise<void> {
  const { ctx, authDeps, trustedLocal, refusedUpgradeLogAt } = state;
  const { core, workstreamsApp } = ctx;
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
  const upgradePathname = reqUrl.split("?")[0] ?? reqUrl;
  if (workstreamsApp && upgradePathname.startsWith("/workstreams/")) {
    const target = workstreamsApp.supervisor.targetFor(reqUrl);
    if (!target || target.kind !== "frontend") {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    prepareWorkstreamsAppHeaders(req.headers, null);
    proxy.ws(req, socket, head, { target: `http://127.0.0.1:${target.port}` }, (error: Error | undefined) => {
      if (error) {
        log(`[workstreams-app] ws proxy error: ${error.message}`);
        socket.destroy();
      }
    });
    return;
  }
  // The spoof wall on the upgrade path too: strip client `x-bbx-*` before the
  // socket is proxied to Vite/the hub (expose-dev-router B.2c). The WS carries
  // the browser session on TCP; it needs no router-injected `x-bbx-*`, so this
  // is a pure strip with no re-injection.
  stripClientBbxHeaders(req.headers);
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
      } catch (_e) {
        /* already gone */
      }
    }
  });
}
