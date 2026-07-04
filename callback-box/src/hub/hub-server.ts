/**
 * `cb hub`'s HTTP/WS router (Track D: chunk D1 shaped the routing seam,
 * chunk D2 adds the auth split, chunk D3 the box picker). Adapted from the
 * monorepo dev router's proxy layer (`../../../bin/router.ts`'s
 * `proxy`/`upgrade` handling), but simplified: no lazy-start
 * (`ensureRunning` becomes a plain `endpoints.get(slug)` lookup -- a box is
 * either up or it isn't, the hub never spawns on first request), no idle
 * shutdown, no Vite/worktree concepts. The routing/proxy layer knows
 * NOTHING about child processes -- it only consumes `EndpointProvider`
 * (`./endpoints.js`), per the plan's "routing consumes endpoints" seam.
 *
 * D2's auth split, and why it lives HERE and not in each box: session
 * cookies are signed with a symmetric HMAC secret, so any process that can
 * VERIFY a cookie could also FORGE one for a sibling box. Under the plan's
 * trust model (hub trusted, boxes mutually untrusting) only the hub may
 * hold that secret. So the hub is the one place that reads the session
 * cookie; every proxied request first has any client-supplied `x-cb-*`
 * header stripped (the spoof wall), then gets a hub-injected, secret-gated
 * identity header attached (`x-cb-authenticated-email` or, when hub-wide
 * auth is off, `x-cb-hub-auth: off`) alongside `x-cb-hub-secret` -- see
 * `src/webapp/auth.ts`'s `resolveRequestIdentity` for the child side of
 * this contract. `/healthz`, the hub's own `/auth/login|callback|logout|me`
 * (registered by `registerAuthSurface` below, not proxied), and
 * `/webhook/<slug>/*` are the paths NOT behind this auth wall (health
 * checks, login itself, and external webhook callers that have never gone
 * through Cloudflare Access either). `/auth/google-services/callback` is
 * NOT in that list even though it shares the `/auth/` prefix -- it's a
 * per-box connector callback, proxied to a child like any other request and
 * gated the same way (see its dedicated route below).
 *
 * A box's own Fastify instance already serves itself under `/<slug>/...`
 * (see `server-box-scope.ts`'s `registerBox`, and `cb serve --slug`) -- so
 * the hub forwards the request's path UNCHANGED to the endpoint's origin,
 * the same "no prefix stripping" shape the dev router uses for `/main/...`.
 */

import type http from "node:http";
import type { Socket } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import httpProxy from "http-proxy-3";
import type { EndpointProvider } from "./endpoints.js";
import type { BoxRuntimeStatus } from "./supervisor.js";
import { registerBoxPicker } from "./box-picker.js";
import { registerAuthSurface } from "../webapp/routes/auth.js";
import { isApiUrl } from "../webapp/server-box-scope.js";
import { listAccessibleBoxes } from "../webapp/server-root.js";
import { canAccessBox } from "../webapp/box-access.js";
import type { BoxSpec } from "../webapp/server-types.js";
import {
  isAuthEnabled,
  getSessionUser,
  getSessionUserFromCookieHeader,
  getOwnerEmail,
  HUB_SECRET_HEADER,
  HUB_EMAIL_HEADER,
  HUB_AUTH_OFF_HEADER,
} from "../webapp/auth.js";

export interface HubHealth {
  status: "ok";
  boxes: BoxRuntimeStatus[];
}

export interface HubServerOptions {
  endpoints: EndpointProvider;
  getHealth: () => HubHealth;
  /** Per-boot secret (see `cli/commands/hub.ts`), shared with every
   *  supervised child's env -- the gate a box uses to trust the identity
   *  headers this module injects. See `src/webapp/auth.ts`'s `isHubMode`. */
  hubSecret: string;
  /** Slug -> resolved box root, for the login surface's `/auth/me`
   *  accessible-boxes list and the box picker (D3). */
  boxes: BoxSpec[];
  /**
   * The hub's own `http://host:port`, per `cli/commands/hub.ts`'s resolved
   * listen config. Passed to `registerAuthSurface` as its OAuth-redirect
   * fallback so `/auth/login` without `CB_PUBLIC_URL` set redirects back to
   * the hub itself, not `registerAuthSurface`'s box-server default of
   * `http://localhost:3210` (the dev router's port, not the hub's).
   */
  baseUrl: string;
}

/** First path segment, e.g. `/test1/browse/x` -> `test1`. Mirrors the dev
 *  router's `parseWorktreeName`. */
function parseSlug(reqPath: string): string | null {
  const m = /^\/([^#/?]+)(?:[#/?]|$)/.exec(reqPath);
  return m ? m[1]! : null;
}

/** `/webhook/<slug>/...` -> `<slug>`. A SEPARATE top-level prefix from a
 *  box's own `/<slug>` scope -- see `RESERVED_SLUGS`'s doc comment. */
function parseWebhookSlug(reqPath: string): string | null {
  const m = /^\/webhook\/([^#/?]+)(?:[#/?]|$)/.exec(reqPath);
  return m ? m[1]! : null;
}

function isWebhookPath(reqPath: string): boolean {
  return reqPath.startsWith("/webhook/");
}

function slugForPath(reqPath: string): string | null {
  return isWebhookPath(reqPath) ? parseWebhookSlug(reqPath) : parseSlug(reqPath);
}

const HUB_HEADER_PREFIX = "x-cb-";

/** The spoof wall: no client-supplied `x-cb-*` header ever reaches a box.
 *  Mutates `headers` in place (both the Fastify proxy path and the raw WS
 *  upgrade path hand this the same `http.IncomingMessage.headers` object). */
function stripHubHeaders(headers: http.IncomingHttpHeaders): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase().startsWith(HUB_HEADER_PREFIX)) delete headers[key];
  }
}

interface HubAuthDecision {
  authorized: boolean;
  /** Headers to inject onto the outgoing (to-child) request when authorized. */
  headersToSet: Record<string, string>;
}

/**
 * The one place that decides what a proxied request tells the child about
 * identity. Shared between the plain-HTTP path (Fastify catch-all route)
 * and the WS-upgrade path (raw `http.IncomingMessage`) so they can't drift.
 */
function decideHubAuth({
  cookieHeader,
  isWebhook,
  hubSecret,
}: {
  cookieHeader: string | undefined;
  isWebhook: boolean;
  hubSecret: string;
}): HubAuthDecision {
  // Webhooks are outside the auth wall today (external callers never went
  // through Cloudflare Access either) -- proxy through with just the hub
  // secret, no identity, so the child still knows this is genuine hub
  // traffic and its webhook routes stay outside ITS auth wall as they
  // already are.
  if (isWebhook) {
    return { authorized: true, headersToSet: { [HUB_SECRET_HEADER]: hubSecret } };
  }
  if (!isAuthEnabled()) {
    return {
      authorized: true,
      headersToSet: { [HUB_SECRET_HEADER]: hubSecret, [HUB_AUTH_OFF_HEADER]: "off" },
    };
  }
  const user = getSessionUserFromCookieHeader(cookieHeader);
  if (!user) return { authorized: false, headersToSet: {} };
  return {
    authorized: true,
    headersToSet: { [HUB_SECRET_HEADER]: hubSecret, [HUB_EMAIL_HEADER]: user.email },
  };
}

/**
 * Build the hub's Fastify app, register its own surface (health, login,
 * box picker), then hijack every other request into the endpoint proxy.
 * Returns the underlying `http.Server` (Fastify's own, after `ready()`) so
 * callers keep the plain `http.Server` interface (`.listen`, `.close`,
 * `.on("upgrade")`) `cli/commands/hub.ts` and the doctests already use.
 */
export async function createHubServer(options: HubServerOptions): Promise<http.Server> {
  const { endpoints, getHealth, hubSecret, boxes, baseUrl } = options;
  const app: FastifyInstance = Fastify({ logger: false, trustProxy: true });
  const boxRootBySlug = new Map(boxes.map((box) => [box.slug, box.boxRoot]));

  // The hub's login routes (routes/auth.ts) read the session cookie via
  // @fastify/cookie's request decoration, same as a standalone box server.
  await app.register(fastifyCookie);

  // The hub proxies request bodies through unread -- registering a
  // catch-all content-type parser that never touches `payload` stops
  // Fastify's default JSON/urlencoded parsers from draining the raw
  // request stream before `proxy.web` can pipe it to the child.
  // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
  app.addContentTypeParser("*", (_request, _payload, done) => {
    done(null);
  });

  app.get("/healthz", async (_request, reply) => reply.send(getHealth()));

  // Login lives at the hub for the whole fleet (Track D, chunk D2) --
  // reuses the SAME routes a standalone box server registers, so there's
  // no second OAuth implementation to drift from the box's.
  await registerAuthSurface(app, { boxes, publicUrlFallback: baseUrl });

  // The box picker (Track D, chunk D3).
  registerBoxPicker(app, { boxes });

  // The frontend's box switcher calls /api/boxes on whatever server it's
  // loaded from -- the standalone server answers it (server-root.ts), but
  // the hub only ever served the HTML picker at "/", so this 404'd behind a
  // hub (caught by "auth"/"api" being reserved slugs the catch-all below
  // can't match to a box). Own it here with the SAME shape and the SAME
  // filter (`listAccessibleBoxes`, which shares `canAccessBox` with the box
  // picker) so the two never drift into different box lists.
  app.get("/api/boxes", async (request) => {
    if (isAuthEnabled()) {
      const user = getSessionUser(request);
      if (!user) return { boxes: [], authRequired: true };
      return { boxes: await listAccessibleBoxes(boxes, user.email) };
    }
    return { boxes: boxes.map((b) => ({ slug: b.slug, name: b.slug })) };
  });

  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  // eslint-disable-next-line max-params -- http-proxy-3's ProxyServer "error" event signature is (err, req, res)
  proxy.on("error", (err: Error, _req, res) => {
    if (res && "writeHead" in res && !(res as http.ServerResponse).headersSent) {
      (res as http.ServerResponse).writeHead(502, { "content-type": "application/json" });
      (res as http.ServerResponse).end(JSON.stringify({ error: "bad_gateway", message: err.message }));
    } else if (res) {
      try {
        (res as http.ServerResponse | Socket).end();
      } catch (_e) {
        /* already gone */
      }
    }
  });

  // The Google-services OAuth callback is a single fleet-wide redirect URI
  // (`GET /auth/google-services/callback`) registered on EVERY child at a
  // path under the "auth" reserved slug, which the generic catch-all below
  // can never route (no box is actually named "auth"). The setup flow
  // (`admin-google.ts`'s `googleSetup`) already encodes which box initiated
  // it in the OAuth `state` param ("boxSlug" or "boxSlug:returnPath", same
  // format `routes/admin.ts`'s callback handler parses) -- so the hub reads
  // just enough of `state` to pick the child, then forwards unchanged. The
  // child's own handler (still registered on every `cb serve`, per-box) is
  // the one that exchanges the code and saves tokens; the hub only routes
  // and injects the same gated identity headers every proxied request gets.
  // Fastify's router (find-my-way) matches this static route ahead of the
  // "/*" wildcard below regardless of registration order, so this always
  // wins for this exact path.
  app.get("/auth/google-services/callback", async (request, reply) => {
    const { state } = request.query as { state?: string };
    const colonIdx = (state ?? "").indexOf(":");
    const boxSlug = colonIdx !== -1 ? (state ?? "").slice(0, colonIdx) : (state ?? "");
    const endpoint = boxSlug ? endpoints.get(boxSlug) : undefined;
    if (!endpoint) {
      return reply.status(400).send({ error: "unknown_box", message: `Unknown box in OAuth state: ${JSON.stringify(boxSlug)}` });
    }

    stripHubHeaders(request.raw.headers);
    const decision = decideHubAuth({ cookieHeader: request.headers.cookie, isWebhook: false, hubSecret });
    if (!decision.authorized) {
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }

    // This route is a per-box connector callback picked purely from the
    // untrusted `state` query param, so unlike the generic catch-all below
    // (which lands inside the TARGET box's own scope and re-checks
    // `canAccessBox` there via `addBoxAuthHook`), nothing downstream ever
    // verifies the caller may access `boxSlug` -- the child's callback
    // handler is registered at server ROOT, ahead of any per-box auth hook
    // (see module doc). Any signed-in fleet user could otherwise complete a
    // Google token grant for someone else's box. Check here, same
    // fail-closed `canAccessBox` semantics as everywhere else. When hub auth
    // is off, `decideHubAuth` already authorized above with no email to
    // check -- pass-through stands (single-operator open mode).
    const email = decision.headersToSet[HUB_EMAIL_HEADER];
    if (email) {
      const boxRoot = boxRootBySlug.get(boxSlug);
      const allowed = boxRoot ? await canAccessBox({ boxRoot, email, ownerEmail: getOwnerEmail() }) : false;
      if (!allowed) {
        return reply.status(403).send({
          error: "forbidden",
          message: `${email} may not access box ${JSON.stringify(boxSlug)}`,
        });
      }
    }
    Object.assign(request.raw.headers, decision.headersToSet);

    reply.hijack();
    proxy.web(request.raw, reply.raw, { target: endpoint.origin });
  });

  // Everything else: gate on identity, then proxy to the box's own Fastify
  // instance unchanged (no prefix stripping -- see module doc).
  app.all("/*", async (request, reply) => {
    const reqPath = request.url.split("?")[0] ?? "/";
    const isWebhook = isWebhookPath(reqPath);

    stripHubHeaders(request.raw.headers);
    const decision = decideHubAuth({ cookieHeader: request.headers.cookie, isWebhook, hubSecret });
    if (!decision.authorized) {
      if (isApiUrl(reqPath)) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }
    Object.assign(request.raw.headers, decision.headersToSet);

    const slug = slugForPath(reqPath);
    const endpoint = slug ? endpoints.get(slug) : undefined;
    if (!endpoint) {
      return reply.status(404).send({ error: "not_found", message: `No running box for ${JSON.stringify(reqPath)}` });
    }

    reply.hijack();
    proxy.web(request.raw, reply.raw, { target: endpoint.origin });
  });

  await app.ready();
  const server = app.server;

  // WS upgrades carry cookies too -- apply the SAME gate/injection here,
  // against the raw `http.IncomingMessage` (Fastify's request decoration
  // isn't available on this event; no @fastify/websocket plugin is
  // registered on the hub's own instance, so nothing else listens for
  // "upgrade" and this is safe to own outright).
  // eslint-disable-next-line max-params -- Node's http "upgrade" event signature is (req, socket, head)
  server.on("upgrade", (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
    const reqPath = req.url ?? "/";
    const isWebhook = isWebhookPath(reqPath);

    stripHubHeaders(req.headers);
    const decision = decideHubAuth({ cookieHeader: req.headers.cookie, isWebhook, hubSecret });
    if (!decision.authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    Object.assign(req.headers, decision.headersToSet);

    const slug = slugForPath(reqPath);
    const endpoint = slug ? endpoints.get(slug) : undefined;
    if (!endpoint) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target: endpoint.origin }, (err) => {
      if (err) socket.destroy();
    });
  });

  return server;
}
