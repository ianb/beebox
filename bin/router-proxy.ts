// The HTTP proxy the router fronts every worktree with, plus its
// retry/body-replay machinery and the `x-cb-*` spoof wall.
//
// This is a REQUEST-level concern, kept deliberately OUT of the lifecycle state
// machine (bin/docs/router-protocol.md, "Fifth candidate that stays OUT of the
// state machine"). It touches the core only through the `ensureRunning`
// handshake every request performs. Split out of router.ts so that file holds
// the server and boot sequence only.

import type http from "node:http";
import { Readable } from "node:stream";
import type { Socket } from "node:net";
import httpProxy from "http-proxy-3";
import { injectBasePrefix } from "../callback-box/src/webapp/base-prefix.js";
import { rewriteMobileCookiePath } from "./router-cookie.js";
import { bootstrapMobileSessionCookie, type MobileBootstrapTarget } from "./router-mobile-bootstrap.js";
import { WORKSTREAMS_APP_CAPABILITY_HEADER, type WorkstreamsAppTarget } from "./workstreams-app-supervisor.js";
import { readyLifecycle } from "./router-lifecycle.js";
import type { WorktreeHandle } from "./router-lifecycle.js";
import type { RouterCore } from "./router-core.js";
import { errMessage, httpStatusOf } from "./router-effects.js";
import { log, parseWorktreeName, sleep } from "./router-config.js";

export const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

/**
 * Socket errors that mean "the peer went away", not "the router is broken".
 * A client abandoning a request is routine during a worktree cold start, and a
 * dev router must not die of it — these are logged-and-ignored everywhere they
 * surface, including the process-level uncaughtException backstop.
 */
export function isBenignSocketError(err: NodeJS.ErrnoException | undefined): boolean {
  if (!err) return false;
  return err.code === "ECONNRESET" || err.code === "EPIPE" || err.code === "ECONNABORTED";
}

// One rest parameter rather than (err, req, res): the emitter fixes the arity,
// and the house limit is two positional parameters.
proxy.on("error", (...handlerArgs: [Error, http.IncomingMessage, http.ServerResponse | Socket | undefined]) => {
  const [err, , res] = handlerArgs;
  log(`proxy error: ${err.message}`);
  if (res && "writeHead" in res && !res.headersSent) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`Bad gateway: ${err.message}\n`);
  } else if (res) {
    try {
      res.end();
    } catch (_e) {
      /* the client socket is already torn down — nothing to write to */
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
  const m = reqPath.match(/^\/[^#/?]+\/([^#/?]+)(?:[#/?]|$)/);
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

/** A request stream with no encoding set yields Buffers; anything else is a
 *  broken invariant, not a shape to degrade around. */
class NonBufferBodyChunkError extends Error {
  constructor(readonly received: string) {
    super(`request body chunk was ${received}, expected a Buffer`);
    this.name = "NonBufferBodyChunkError";
  }
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  // The router never calls setEncoding, so every chunk is a Buffer — the guard
  // narrows `unknown` in place of an `as Buffer` cast.
  for await (const chunk of req) {
    if (!Buffer.isBuffer(chunk)) throw new NonBufferBodyChunkError(typeof chunk);
    chunks.push(chunk);
  }
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
export function stripClientCbHeaders(headers: http.IncomingHttpHeaders): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith(CB_HEADER_PREFIX)) delete headers[key];
  }
}

/** Apply the workstreams app's private hop capability after the spoof wall. */
export function prepareWorkstreamsAppHeaders(
  headers: http.IncomingHttpHeaders,
  capability: string | null,
): void {
  stripClientCbHeaders(headers);
  if (capability !== null) headers[WORKSTREAMS_APP_CAPABILITY_HEADER] = capability;
}

/**
 * A start superseded mid-flight (invariant #5) resolves to a non-ready handle.
 * Carrying ECONNREFUSED makes the retry loop treat it exactly like a cold
 * upstream port, which is what it is.
 */
class WorktreeNotReadyError extends Error {
  readonly code = "ECONNREFUSED";
  constructor(readonly worktree: string) {
    super(`worktree ${worktree} not ready`);
    this.name = "WorktreeNotReadyError";
  }
}

/** One proxy attempt. Resolves with the proxy error, or null on success. */
function proxyOnce(
  req: http.IncomingMessage,
  { res, frontendPort, body }: { res: http.ServerResponse; frontendPort: number; body: Buffer | null },
): Promise<(Error & { code?: string }) | null> {
  return new Promise((resolve) => {
    const target = `http://127.0.0.1:${frontendPort}`;
    // The proxy callback fires only on error; success is the response closing.
    res.on("close", () => resolve(null));
    const options = body === null ? { target } : { target, buffer: Readable.from(body) };
    proxy.web(req, res, options, (err: Error & { code?: string } | undefined) => resolve(err ?? null));
  });
}

/** The resident app does not cold-start or retry request bodies. */
export function proxyWorkstreamsAppOnce(
  req: http.IncomingMessage,
  { res, target }: { res: http.ServerResponse; target: WorkstreamsAppTarget },
): Promise<(Error & { code?: string }) | null> {
  prepareWorkstreamsAppHeaders(req.headers, target.kind === "backend" ? target.capability : null);
  return new Promise((resolve) => {
    res.on("close", () => resolve(null));
    proxy.web(req, res, { target: `http://127.0.0.1:${target.port}` }, (error) => resolve(error ?? null));
  });
}

export async function proxyWithRetry(
  req: http.IncomingMessage,
  {
    res,
    name,
    retries,
    core,
    mobileBootstrap,
  }: {
    res: http.ServerResponse;
    name: string;
    retries: number;
    core: RouterCore;
    mobileBootstrap: MobileBootstrapTarget | null;
  },
): Promise<void> {
  let retriesLeft = retries;
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
    let err: (Error & { code?: string }) | null = null;
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
      err = await proxyOnce(req, { res, frontendPort: ready.frontendPort, body });
    } else {
      const notReady: WorktreeNotReadyError = new WorktreeNotReadyError(name);
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
      } catch (_e) {
        /* already ended */
      }
    }
    return;
  }
}
