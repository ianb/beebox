/**
 * `/<slug>/browser/`: the person's view of the box browser
 * (docs/plans/shared-browser.md, Track C).
 *
 * The page is agent-browser's own dashboard, served by the browser host on
 * its relay socket and proxied here onto the box's origin, so the person
 * reaches it through beebox's login with no second credential. The dashboard
 * assumes it is served at the root, so HTML, CSS and scripts are buffered and
 * their `/_next/` and `/api/` paths rewritten under the prefix
 * (`rewriteDashboardBody`); everything else streams through unchanged.
 *
 * Upstream, the request looks like one from the dashboard's own loopback
 * page (`Host: localhost`, `Origin: http://localhost`), which is the only
 * kind it accepts, and carries none of the person's credentials: no cookie,
 * no `Authorization`, no hub headers. The checks that matter (a person, this
 * box, this origin) are made here first, in `person-gate.ts`.
 *
 * The routes live in their own encapsulated scope with no body parsing: the
 * built-in JSON parser drains the request stream, which left every proxied
 * JSON POST hanging behind the hub (`src/hub/server/core.ts`), and the
 * dashboard's `/api/exec` is a JSON POST. The POSTs that can reach another
 * session are the exception: their bodies are read here, checked
 * (`dashboard-post.ts`), and sent on from the buffer.
 */

import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ProxyServer } from "http-proxy-3";
import { BrowserCommandSocketError, sendBrowserCommand } from "../../../../core/browser/command-socket.js";
import { BrowserHostFailedError, BrowserNotInstalledError, ensureBrowserHost, type BrowserHostHandle } from "../../../../core/browser/host/start.js";
import { isRewritableType, rewriteDashboardBody } from "../../../../core/browser/rewrite.js";
import { SESSION_PROBLEM_PREFIX } from "../../../../core/browser/session.js";
import type { Services } from "../../../../services/container.js";
import { checkDashboardPost, DASHBOARD_POST_CAP_BYTES, isCheckedDashboardPost } from "./dashboard-post.js";
import { browserPrefix } from "./prefix.js";
import { checkPerson, sendRefusal } from "./person-gate.js";
import { BROWSER_PAGE_CSP, decodeBody, messagePage, responseHeaders, withNotice } from "./response.js";
import { bridgeStream } from "./stream-bridge.js";

export interface BrowserProxyContext {
  readonly server: FastifyInstance;
  readonly boxRoot: string;
  readonly boxSlug: string;
  readonly services: Services;
}

/** Request headers the dashboard never sees: the person's credentials and what proxies in front added. */
function isDroppedRequestHeader(name: string): boolean {
  return name === "cookie" || name === "authorization" || name === "x-real-ip" || name.startsWith("x-bbx-") || name.startsWith("x-forwarded-");
}

/** What the dashboard sees as the request's own headers: those of a loopback page asking for unencoded bodies. */
const UPSTREAM_HEADERS = { host: "localhost", origin: "http://localhost", "accept-encoding": "identity" };

/** Send an HTML page the proxy wrote itself, with the page CSP. */
function sendPage(reply: FastifyReply, page: { status: number; title: string; detail: string }): FastifyReply {
  return reply
    .status(page.status)
    .header("content-type", "text/html; charset=utf-8")
    .header("content-security-policy", BROWSER_PAGE_CSP)
    .header("cache-control", "no-store")
    .send(messagePage(page));
}

/** The page for a host that cannot be reached, or null for an error this route does not explain. */
function hostFailurePage(e: unknown): { status: number; title: string; detail: string } | null {
  if (e instanceof BrowserNotInstalledError) return { status: 503, title: "No browser installed", detail: e.reason };
  if (e instanceof BrowserHostFailedError) return { status: 502, title: "The box browser did not start", detail: e.message };
  return null;
}

interface Upstream {
  readonly reply: FastifyReply;
  readonly relaySocket: string;
  readonly path: string;
  /** The request body, already read; null to stream it from the request. */
  readonly body: Buffer | null;
  readonly createProxy: () => ProxyServer;
}

/** Send the request to the dashboard behind `relaySocket` and resolve with its response, unread. */
function forward(request: FastifyRequest, upstream: Upstream): Promise<IncomingMessage> {
  const raw = request.raw;
  for (const name of Object.keys(raw.headers)) {
    if (isDroppedRequestHeader(name)) delete raw.headers[name];
  }
  if (upstream.body !== null) {
    // The dashboard reads exactly `Content-Length` bytes and ignores chunked framing.
    delete raw.headers["transfer-encoding"];
    raw.headers["content-length"] = String(upstream.body.length);
  }
  return new Promise((resolve, reject) => {
    // One proxy per request, so its single `proxyRes` belongs to this request.
    const proxy = upstream.createProxy();
    proxy.once("proxyRes", resolve);
    // http-proxy-3 reads the path from `req.url` once, synchronously, inside `web`.
    const original = raw.url;
    raw.url = upstream.path;
    try {
      proxy.web(
        raw,
        // Not written to (`selfHandleResponse`); its close aborts the upstream request.
        upstream.reply.raw,
        {
          target: { host: "localhost", port: 0, socketPath: upstream.relaySocket },
          selfHandleResponse: true,
          headers: UPSTREAM_HEADERS,
          ...(upstream.body === null ? {} : { buffer: Readable.from([upstream.body]) }),
        },
        (e) => reject(e),
      );
    } finally {
      raw.url = original;
    }
  });
}

/** The whole response body. */
async function readAll(stream: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}

/** The request body, or null when it is over `cap` bytes (the rest is still read and dropped). */
async function readCapped(stream: IncomingMessage, cap: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes <= cap) chunks.push(buffer);
  }
  return bytes > cap ? null : Buffer.concat(chunks);
}

/** True for the path of the dashboard's top page, `/` with or without a query. */
function isTopPage(path: string): boolean {
  return path === "/" || path.startsWith("/?");
}

/** A root-relative redirect from the dashboard, moved under the prefix. */
function prefixedLocation(location: string | undefined, prefix: string): string | undefined {
  if (location === undefined || !location.startsWith("/") || location.startsWith("//")) return location;
  return `${prefix}${location}`;
}

/**
 * Start the box session for the top page; a failure becomes a notice on the
 * page. Any launching command starts it: the command socket runs
 * `ensureBoxSession` first.
 */
async function sessionNotice(host: BrowserHostHandle): Promise<string | null> {
  try {
    const reply = await sendBrowserCommand(host.paths.cliSocket, ["get", "url"]);
    if (reply.exitCode !== 0) return `Could not start the box browser: ${reply.stderr.trim() || `exit code ${String(reply.exitCode)}`}`;
    const problem = reply.stderr.split("\n").find((line) => line.startsWith(SESSION_PROBLEM_PREFIX));
    return problem === undefined ? null : problem.slice(SESSION_PROBLEM_PREFIX.length);
  } catch (e) {
    if (e instanceof BrowserCommandSocketError) return e.message;
    throw e;
  }
}

/** Register `/browser` and everything under it in the box scope. */
export async function registerBrowserProxyRoutes(ctx: BrowserProxyContext): Promise<void> {
  const { server, boxRoot, boxSlug, services } = ctx;
  const ensureHost = services.browserHost ?? ensureBrowserHost;
  // Loaded here rather than at module load: every `bbx` verb loads the server modules.
  const { createProxyServer } = await import("http-proxy-3");
  const createProxy = (): ProxyServer => createProxyServer({});
  const marker = `/${boxSlug}/browser`;

  await server.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
    scope.addContentTypeParser("*", (_request, _payload, done) => {
      done(null);
    });
    const gate = { boxRoot, openAccess: scope.openAccess };
    scope.addHook("preHandler", async (request, reply) => {
      const refusal = await checkPerson(gate, request);
      // Returning the reply tells Fastify the hook answered, so the handler does not run.
      if (refusal === null) return;
      return sendRefusal(refusal, { request, reply });
    });

    scope.all("/browser", (request, reply) => {
      // Relative, so it works under any outer prefix: from `.../<slug>/browser`, `browser/` is `.../<slug>/browser/`.
      const query = request.url.indexOf("?");
      return reply.redirect(`browser/${query === -1 ? "" : request.url.slice(query)}`);
    });

    scope.get<{ Params: { port: string } }>("/browser/api/session/:port/stream", { websocket: true }, (socket, request) => {
      const port = Number(request.params.port);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        socket.close(1008, "invalid session port");
        return;
      }
      bridgeStream(socket, { relaySocket: ensureHost({ boxRoot, slug: boxSlug }).then((host) => host.paths.relaySocket), port });
    });

    scope.all("/browser/*", async (request, reply) => {
      if (!request.url.startsWith(`${marker}/`)) return reply.status(404).send({ error: "Not found" });
      const path = request.url.slice(marker.length);
      const prefix = browserPrefix({ slug: boxSlug, forwardedPrefix: request.headers["x-forwarded-prefix"] });
      let requestBody: Buffer | null = null;
      if (isCheckedDashboardPost({ method: request.method, path })) {
        if (Number(request.headers["content-length"] ?? 0) > DASHBOARD_POST_CAP_BYTES) return reply.status(413).send({ error: "request body too large" });
        requestBody = await readCapped(request.raw, DASHBOARD_POST_CAP_BYTES);
        if (requestBody === null) return reply.status(413).send({ error: "request body too large" });
        const check = checkDashboardPost(path, requestBody);
        if (!check.ok) return reply.status(check.status).send({ error: check.error });
      }
      let host: BrowserHostHandle;
      try {
        host = await ensureHost({ boxRoot, slug: boxSlug });
      } catch (e) {
        const page = hostFailurePage(e);
        if (page === null) throw e;
        return sendPage(reply, page);
      }
      const notice = request.method === "GET" && isTopPage(path) ? await sessionNotice(host) : null;
      let upstream: IncomingMessage;
      try {
        upstream = await forward(request, { reply, relaySocket: host.paths.relaySocket, path, body: requestBody, createProxy });
      } catch (e) {
        return sendPage(reply, { status: 502, title: "The box browser did not answer", detail: e instanceof Error ? e.message : String(e) });
      }
      const contentType = upstream.headers["content-type"];
      const rewritten = isRewritableType(contentType) && request.method !== "HEAD";
      reply.status(upstream.statusCode ?? 502).headers(responseHeaders(upstream.headers, rewritten));
      const location = prefixedLocation(upstream.headers.location, prefix);
      if (location !== undefined) reply.header("location", location);
      if (!rewritten) return reply.send(upstream);
      const isHtml = (contentType ?? "").toLowerCase().startsWith("text/html");
      let body = rewriteDashboardBody(await decodeBody(await readAll(upstream), upstream.headers["content-encoding"]), prefix);
      // The prefix depends on a request header, so no rewritten response may be cached.
      reply.header("cache-control", "no-store").header("vary", "X-Forwarded-Prefix");
      if (isHtml) {
        if (notice !== null) body = withNotice(body, notice);
        reply.header("content-security-policy", BROWSER_PAGE_CSP).header("referrer-policy", "same-origin");
      }
      return reply.send(body);
    });
  });
}
