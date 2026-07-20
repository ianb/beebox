/**
 * `cb hub`'s HTTP/WS router (Track D: chunk D1 shaped the routing seam,
 * chunk D2 adds the auth split, chunk D3 the box picker). Adapted from the
 * monorepo dev router's proxy layer (`../../../bin/router.ts`'s
 * `proxy`/`upgrade` handling), but simplified relative to that router: no
 * Vite/worktree concepts. Lazy-start/idle-shutdown IS supported, opt-in per
 * hub via `hub.json`'s `lazy` flag (`Supervisor`, in `./supervisor.ts`,
 * mirrors the dev router's `ensureRunning`/idle-timer semantics) -- see
 * `resolveEndpoint()` below, which prefers `EndpointProvider.ensureRunning`
 * when the provider offers it and falls back to a plain `endpoints.get(slug)`
 * lookup otherwise (a non-lazy hub's boxes are resident: either up or not,
 * never spawned on request). The routing/proxy layer knows
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
import fs from "node:fs";
import path from "node:path";
import { isRecord } from "../lib/is-record.js";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import httpProxy from "http-proxy-3";
import type { Endpoint, EndpointProvider } from "./endpoints.js";
import type { BoxRuntimeStatus } from "./supervisor.js";
import { registerBoxPicker } from "./box-picker.js";
import { registerAuthSurface } from "../webapp/routes/auth.js";
import { isPairingRedeemUrl } from "../webapp/routes/pairing.js";
import { isApiUrl } from "../webapp/server-box-scope.js";
import { listAccessibleBoxes } from "../webapp/server-root.js";
import { canAccessBox } from "../webapp/box-access.js";
import { verifyMobileRequest } from "../core/mobile/request-auth.js";
import type { BoxSpec } from "../webapp/server-types.js";
import { PACKAGE_ROOT } from "../lib/package-root.js";
import {
  authRequired,
  resolveRequestIdentity,
  getOwnerEmail,
  HUB_SECRET_HEADER,
  HUB_EMAIL_HEADER,
  HUB_AUTH_OFF_HEADER,
} from "../webapp/auth.js";
import { invariant } from "../lib/invariant.js";
import type { HubVerdict } from "./hub-health.js";
import { registerHealthRoutes } from "./hub-health-routes.js";

export interface HubHealth {
  /** Derived in `cli/commands/hub.ts` via `hubVerdict()` — `"unhealthy"`
   *  (served as HTTP 503) if any box is crash-looping or has latched
   *  unhealthy, else `"ok"` (200). See `hub-health.ts`. */
  status: HubVerdict;
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
  if (!m) return null;
  const slug = m[1];
  invariant(slug !== undefined, "regex match must populate its required capture group");
  return slug;
}

/** `/webhook/<slug>/...` -> `<slug>`. A SEPARATE top-level prefix from a
 *  box's own `/<slug>` scope -- see `RESERVED_SLUGS`'s doc comment. */
function parseWebhookSlug(reqPath: string): string | null {
  const m = /^\/webhook\/([^#/?]+)(?:[#/?]|$)/.exec(reqPath);
  if (!m) return null;
  const slug = m[1];
  invariant(slug !== undefined, "regex match must populate its required capture group");
  return slug;
}

function isWebhookPath(reqPath: string): boolean {
  return reqPath.startsWith("/webhook/");
}

function slugForPath(reqPath: string): string | null {
  return isWebhookPath(reqPath) ? parseWebhookSlug(reqPath) : parseSlug(reqPath);
}

/**
 * Does this request carry mobile-device auth the named box actually accepts?
 *
 * This VERIFIES; it used to only check that an `Authorization: Bearer ` prefix
 * or a `?mobileToken=` param was present, which meant the literal string
 * "Bearer x" was enough to skip the hub's auth wall and be proxied to a box —
 * cold-starting a stopped box for an unauthenticated caller (known risk S1 in
 * `docs/mobile-contract.md`). Verifying here is affordable because the cookie
 * path is pure HMAC with no filesystem access.
 */
function hasMobileAuth(opts: {
  boxRoot: string | undefined;
  headers: http.IncomingHttpHeaders;
}): boolean {
  if (opts.boxRoot === undefined) return false;
  return verifyMobileRequest(opts.boxRoot, opts.headers);
}

function listMobileAuthorizedBoxes(opts: {
  boxes: BoxSpec[];
  headers: http.IncomingHttpHeaders;
}): Array<{ slug: string; name: string }> {
  return opts.boxes
    .filter((box) => verifyMobileRequest(box.boxRoot, opts.headers))
    .map((box) => ({ slug: box.slug, name: box.slug }));
}

/**
 * The hub's `/api/boxes` response — mirrors `server-root.ts`'s handler, routed
 * through the SAME identity resolver (FIX 1): a stale-`gen` cookie is not a user,
 * and a corrupt credential store answers `503`, not a bogus empty list.
 */
async function respondHubBoxes(opts: {
  boxes: BoxSpec[];
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<{ boxes: Array<{ slug: string; name: string }>; authRequired?: boolean } | FastifyReply> {
  const { boxes, request, reply } = opts;
  if (!authRequired()) return { boxes: boxes.map((b) => ({ slug: b.slug, name: b.slug })) };
  const mobileBoxes = listMobileAuthorizedBoxes({ boxes, headers: request.headers });
  if (mobileBoxes.length > 0) return { boxes: mobileBoxes };
  const identity = resolveRequestIdentity(request);
  if (identity.source === "unavailable") {
    return reply.status(503).send({ error: "Authentication temporarily unavailable" });
  }
  if (!identity.email) return { boxes: [], authRequired: true };
  return { boxes: await listAccessibleBoxes(boxes, identity.email) };
}

/**
 * The single resolve path EVERY proxied HTTP route (the catch-all below and
 * the dedicated `/auth/google-services/callback` route) must use. A lazy
 * provider's `ensureRunning` already both cold-starts a stopped box AND
 * refreshes its idle timer when it's already running (`Supervisor.
 * ensureRunning`'s `touch()` call on the "running" branch) -- so routing
 * `get()`-then-`ensureRunning()`-on-miss (the pre-fix shape) only cold-starts
 * but never refreshes activity for a box that's already up, letting an
 * actively-used box's idle timer expire out from under live traffic. Always
 * preferring `ensureRunning` when the provider offers it fixes that with no
 * new provider surface; a provider without it (e.g. a test's
 * `staticEndpointProvider`) falls back to plain `get()`, unchanged from
 * before. WS upgrades deliberately do NOT go through this helper -- see the
 * "upgrade" handler below for why.
 */
async function resolveEndpoint(slug: string, endpoints: EndpointProvider): Promise<Endpoint | undefined> {
  if (endpoints.ensureRunning) return endpoints.ensureRunning(slug);
  return endpoints.get(slug);
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
  // The hub advertises `x-cb-hub-auth: off` to its children ONLY when the hub
  // itself was started with the `CB_ALLOW_UNAUTHENTICATED` opt-out — i.e.
  // hub-wide open mode. Google configuration no longer decides this.
  if (!authRequired()) {
    return {
      authorized: true,
      headersToSet: { [HUB_SECRET_HEADER]: hubSecret, [HUB_AUTH_OFF_HEADER]: "off" },
    };
  }
  // Verify the cookie through the SAME resolver the boxes use (FIX 1): this
  // applies the `gen` session-revocation check and the distinct "unavailable"
  // (corrupt store) fail-closed outcome that a bare `getSessionUserFromCookieHeader`
  // (HMAC + expiry only) skipped. The hub process is never in hub mode
  // (`isHubMode()` false — it mints the secret, it doesn't receive one), so the
  // resolver takes its cookie path here.
  const identity = resolveRequestIdentity({ headers: { cookie: cookieHeader } });
  if (identity.source === "cookie" && identity.email) {
    return {
      authorized: true,
      headersToSet: { [HUB_SECRET_HEADER]: hubSecret, [HUB_EMAIL_HEADER]: identity.email },
    };
  }
  // Not authenticated, or the store is unavailable — fail closed either way. The
  // hub must NOT inject an identity header when it can't verify the cookie's gen;
  // a `null`/`"unavailable"` outcome both mean "no trusted identity."
  return { authorized: false, headersToSet: {} };
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

  // The hub proxies request bodies through unread -- the catch-all
  // content-type parser below never touches `payload`, so `proxy.web` can
  // pipe the raw request stream to the child. The built-in parsers must go
  // first: Fastify's own application/json and text/plain parsers take
  // precedence over a catch-all "*", and they drain the stream, which left
  // every JSON webhook POST (e.g. Telegram) hanging behind the hub.
  app.removeAllContentTypeParsers();
  // eslint-disable-next-line max-params -- Fastify's addContentTypeParser callback signature is (request, payload, done)
  app.addContentTypeParser("*", (_request, _payload, done) => {
    done(null);
  });

  // Health surface: passive verdict (`/healthz`) + active canary
  // (`/healthz/canary`), both diag-key-gated. See `hub-health-routes.ts`.
  registerHealthRoutes(app, { endpoints, getHealth });

  // Login lives at the hub for the whole fleet (Track D, chunk D2) --
  // reuses the SAME routes a standalone box server registers, so there's
  // no second OAuth implementation to drift from the box's.
  await registerAuthSurface(app, { boxes, publicUrlFallback: baseUrl });

  // The box picker at "/" — serves the SPA's styled box-selection page (with a
  // minimal server-rendered fallback when the bundle isn't built).
  const frontendDist = path.join(PACKAGE_ROOT, "src/frontend/dist");
  registerBoxPicker(app, { boxes, frontendDist });

  // The frontend's box switcher calls /api/boxes on whatever server it's
  // loaded from -- the standalone server answers it (server-root.ts), but
  // the hub only ever served the HTML picker at "/", so this 404'd behind a
  // hub (caught by "auth"/"api" being reserved slugs the catch-all below
  // can't match to a box). Own it here with the SAME shape and the SAME
  // filter (`listAccessibleBoxes`, which shares `canAccessBox` with the box
  // picker) so the two never drift into different box lists.
  app.get("/api/boxes", (request, reply) => respondHubBoxes({ boxes, request, reply }));

  // Shared frontend static, served at the ROOT for the whole fleet. The built
  // SPA references its bundles by ABSOLUTE path (`/assets/...`, `/icons/...`,
  // `/manifest.webmanifest`): Vite bakes base="/" and the box slug is derived at
  // runtime from the URL, never from the asset paths (frontend/src/api-core.ts).
  // The hub does no prefix stripping, so a root `/assets/X` request carries no
  // slug for the "/*" catch-all to route — without these routes every JS/CSS
  // 404s and every box renders blank. The build is identical for all boxes, so
  // one root mount serves the fleet. Ungated: a client bundle is public and must
  // load before the user can auth-navigate. find-my-way matches these ahead of
  // the "/*" proxy wildcard regardless of registration order. (frontendDist is
  // computed above, where the box picker also uses it.)
  if (fs.existsSync(path.join(frontendDist, "index.html"))) {
    // assets first — its default decorateReply provides reply.sendFile below.
    await app.register(fastifyStatic, { root: path.join(frontendDist, "assets"), prefix: "/assets/" });
    for (const dir of ["icons", "earcons"]) {
      const root = path.join(frontendDist, dir);
      if (fs.existsSync(root)) await app.register(fastifyStatic, { root, prefix: `/${dir}/`, decorateReply: false });
    }
    for (const file of ["manifest.webmanifest", "sw.js"]) {
      if (fs.existsSync(path.join(frontendDist, file))) {
        app.get(`/${file}`, (_request, reply) => reply.sendFile(file, frontendDist));
      }
    }
  }

  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  // eslint-disable-next-line max-params -- http-proxy-3's ProxyServer "error" event signature is (err, req, res)
  proxy.on("error", (err: Error, _req, res) => {
    // `res` is `http.ServerResponse | net.Socket` (http-proxy-3 fires this for
    // both proxied requests and WS upgrades); the `in` guard narrows to the
    // HTTP-response arm, which alone can send a 502 body.
    if ("writeHead" in res && !res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_gateway", message: err.message }));
    } else {
      try {
        res.end();
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
    const query: unknown = request.query;
    const state = isRecord(query) && typeof query["state"] === "string" ? query["state"] : undefined;
    const colonIdx = (state ?? "").indexOf(":");
    const boxSlug = colonIdx !== -1 ? (state ?? "").slice(0, colonIdx) : (state ?? "");
    // Routed through the same `resolveEndpoint` helper as every other
    // proxied route (P2 review fix): a lazy hub's box may have been
    // idle-collected while the user was slow on Google's consent screen --
    // without this, the callback 400s as "unknown_box" even though the box
    // is configured, just not currently running.
    let endpoint: Endpoint | undefined;
    try {
      endpoint = boxSlug ? await resolveEndpoint(boxSlug, endpoints) : undefined;
    } catch (e) {
      return reply.status(502).send({ error: "bad_gateway", message: describeHubError(e) });
    }
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
    const isMobilePairingRedeem = request.method === "POST" && isPairingRedeemUrl(reqPath);
    const slug = slugForPath(reqPath);
    const mobileAuthed = slug !== null
      && hasMobileAuth({ boxRoot: boxRootBySlug.get(slug), headers: request.headers });

    stripHubHeaders(request.raw.headers);
    const decision = decideHubAuth({ cookieHeader: request.headers.cookie, isWebhook, hubSecret });
    if (!isMobilePairingRedeem && !mobileAuthed && !decision.authorized) {
      if (isApiUrl(reqPath)) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }
    if (!isMobilePairingRedeem && !mobileAuthed) {
      Object.assign(request.raw.headers, decision.headersToSet);
    }

    // A lazy hub's box may be "stopped" (idle-collected or never yet
    // requested) — ensureRunning cold-starts it and waits for readiness,
    // same as bin/router.ts's ensureRunning does for a whole worktree, AND
    // (unlike a plain get()) refreshes the idle timer when the box is
    // already running -- see resolveEndpoint's doc comment for why this
    // must be the ONLY resolve path every HTTP route uses. A non-lazy
    // Supervisor's ensureRunning is just get() under the hood, so this one
    // call covers both hub flavors; a provider without the method at all
    // (e.g. a test's staticEndpointProvider) falls back to plain get().
    let endpoint: Endpoint | undefined;
    try {
      endpoint = slug ? await resolveEndpoint(slug, endpoints) : undefined;
    } catch (e) {
      return reply.status(502).send({ error: "bad_gateway", message: describeHubError(e) });
    }
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
    const slug = slugForPath(reqPath);
    const mobileAuthed = slug !== null
      && hasMobileAuth({ boxRoot: boxRootBySlug.get(slug), headers: req.headers });

    stripHubHeaders(req.headers);
    const decision = decideHubAuth({ cookieHeader: req.headers.cookie, isWebhook, hubSecret });
    if (!mobileAuthed && !decision.authorized) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!mobileAuthed) {
      Object.assign(req.headers, decision.headersToSet);
    }

    const endpoint = slug ? endpoints.get(slug) : undefined;
    if (!endpoint) {
      // WebSocket upgrades never cold-start a lazy hub's box — same
      // rationale as bin/router.ts's WS handler: ws clients (tRPC's
      // wsLink, in particular) auto-reconnect on timers, so honoring an
      // upgrade as "activity" would let an abandoned background tab
      // resurrect an idle-collected box forever. A KNOWN slug that just
      // isn't running right now gets 503 (client backs off and retries;
      // the box comes back on the next real HTTP request); an
      // unconfigured slug still gets a plain 404.
      const known = slug !== null && endpoints.slugs().includes(slug);
      const status = known ? "503 Service Unavailable" : "404 Not Found";
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target: endpoint.origin }, () => {
      // This callback fires only from http-proxy's error path (see
      // ws-incoming.js's onOutgoingError) -- never on success -- so an
      // invocation always means the upgrade failed.
      socket.destroy();
    });
  });

  return server;
}

function describeHubError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
