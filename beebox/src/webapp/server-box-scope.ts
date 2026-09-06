/**
 * Per-box route registration for the web app server.
 *
 * Each box is mounted under its slug prefix (main routes + tRPC + static)
 * and its webhooks are mounted under /webhook/<slug> outside the auth wall.
 * Split out of server.ts to keep that file under its line budget.
 */

import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { registerApiRoutes } from "./routes/api.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerViewRoutes } from "./routes/views.js";
import { registerFigureRoutes } from "./routes/figure.js";
import { registerBoxIdentityAssetRoutes } from "./routes/box-identity-assets.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { registerSecretsRoutes } from "./routes/secrets.js";
import { registerBulkUploadRoutes } from "./routes/bulk-upload.js";
import { registerScanUploadRoutes } from "./routes/scan-upload.js";
import { isPairingRedeemUrl, registerPairingRoutes } from "./routes/pairing.js";
import { appRouter } from "./trpc/router.js";
import type { TrpcContext } from "./trpc/context.js";
import {
  isHubMode,
  getOwnerEmail,
  isDiagnosticBypassRequest,
} from "./auth.js";
import { resolveBoxIdentity } from "./box-identity.js";
import { verifyAgentBearer } from "../core/agent/token.js";
import { verifyBrowseKey } from "../core/browse-key.js";
import { resolveMobileRequestAuth } from "../core/mobile/request-auth.js";
import { renewMobileSessionCookie } from "./mobile-cookie.js";
import { canAccessBox } from "./box-access.js";
import { loginRedirect } from "./base-prefix.js";
import type { EventBus } from "../core/event-bus.js";
import { closeBoxWatcher } from "../core/box/file-watcher.js";
import { ensureSchemaWatcher, closeSchemaWatcher } from "../core/schema-watcher.js";
import type { BoxSpec, InternalServerOptions } from "./server-types.js";
import { assertNever, invariant } from "../lib/invariant.js";
import { AuthStoreUnavailableAtContextError } from "./local-users-errors.js";

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

/** Exported for the hub (`src/hub/hub-server.ts`), which needs the same
 *  HTML-navigation-vs-API distinction when a proxied request is
 *  unauthenticated: API/WS gets 401, HTML navigation gets a login redirect. */
export function isApiUrl(url: string): boolean {
  return url.includes("/api/") || url.includes("/trpc/") || url.includes("/events");
}

/**
 * Per-box auth preHandler: verify identity and box-level access. Installed
 * whenever authentication is required (`!instance.openAccess` — the always-on
 * default) OR this box is running behind a hub (`isHubMode()`); skipped only
 * in open access (the `openAccess` construction option). Lets
 * static assets and diagnostic-bypass requests
 * through; redirects page navigations to login and 401s API calls —
 * EXCEPT in hub mode, where the box never redirects to its own
 * `/auth/login` (the hub owns login and gates page navigation before
 * proxying, so a child 401 here means the request bypassed the hub —
 * spoofed headers or a misconfigured proxy, not "please log in").
 */
function addBoxAuthHook(instance: FastifyInstance, box: BoxSpec): void {
  instance.addHook("preHandler", async (request, reply) => {
    // CORS preflight carries no credentials and triggers no side effect — the
    // browser only reads the response headers to decide whether to send the
    // real (still-authed) request, so never 401 it. Extension-origin preflights
    // are already short-circuited at the root (registerChromeExtensionCors);
    // this covers any other OPTIONS that reaches the box scope.
    if (request.method === "OPTIONS") return;
    // Let static assets (served by fastify-static) through. Scope this
    // narrowly: API paths (like /api/files/foo.jpg) need the auth
    // check even when they end in an asset extension.
    const urlPath = request.url.split("?")[0];
    invariant(urlPath !== undefined, "String.split always returns at least one element");
    if (!isApiUrl(urlPath) && ASSET_EXTENSIONS.test(urlPath)) {
      return;
    }
    // Diagnostic API key bypass for read-only debug/health endpoints
    if (isDiagnosticBypassRequest(request)) {
      return;
    }
    if (request.method === "POST" && isPairingRedeemUrl(request.url)) {
      return;
    }
    // The box's own agents (chat subprocess, scheduled scripts) call back in
    // with the per-box loopback token from their env — box-scoped auth, same
    // trust as the box user they run as. See core/agent-token.ts.
    if (verifyAgentBearer(box.boxRoot, request.headers["authorization"])) {
      return;
    }
    // An agent driving a real browser, when the operator has opted in by
    // setting BBX_BROWSE_API_KEY. No-op when unset. See core/browse-key.ts.
    if (verifyBrowseKey(request.headers)) {
      return;
    }
    // Mobile devices authenticate with either the durable device token in an
    // Authorization header or the short-lived bbx_mobile cookie; one resolver
    // decides for every gate (see core/mobile/request-auth.ts).
    const mobileAuth = await resolveMobileRequestAuth(box.boxRoot, request.headers);
    if (mobileAuth) {
      renewMobileSessionCookie(reply, { boxRoot: box.boxRoot, boxSlug: box.slug, auth: mobileAuth });
      return;
    }
    const identity = await resolveBoxIdentity({
      boxRoot: box.boxRoot,
      request,
      openAccess: instance.openAccess,
    });
    switch (identity.source) {
      case "unavailable":
        // The credential store is corrupt/unreadable: fail CLOSED and DISTINCTLY
        // (503, not 401) — treating it as "no session" would fail OPEN for exactly
        // the sessions gen-revocation exists to kill (Track D).
        return reply.status(503).send({ error: "Authentication temporarily unavailable" });
      case "open":
        return; // hub-wide (or standalone opt-out) auth is off
      // `browse` is unreachable here (the browse-key bypass above already
      // returned), but it answers the same way the others do: a browse identity
      // carries the owner's email, so it goes through the access check below.
      case "hub":
      case "cookie":
      case "browse":
      case null:
        break; // fall through to the email-based access check below
      default:
        assertNever(identity.source);
    }
    const email = identity.email;
    if (!email) {
      if (isApiUrl(request.url)) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      if (isHubMode()) {
        return reply.status(401).send({
          error: "Not authenticated",
          detail:
            "This box is served behind a hub, which gates page navigation before proxying. " +
            "Reaching this box unauthenticated means the request bypassed the hub, or the " +
            "hub-injected identity headers were missing/invalid (spoof or misconfiguration).",
        });
      }
      return loginRedirect(request, reply);
    }
    if (!(await canAccessBox({ boxRoot: box.boxRoot, email, ownerEmail: getOwnerEmail() }))) {
      return reply.status(403).send({ error: "Not authorized for this box" });
    }
  });
}

interface BoxScopeDeps {
  box: BoxSpec;
  eventBus: EventBus;
  options: InternalServerOptions;
  frontendPath: string;
  frontendExists: boolean;
}

/**
 * Register the main per-box scope under `/<slug>`: auth hook, tRPC,
 * the REST routes that can't move to tRPC, box admin, and static frontend.
 */
async function registerBoxRoutes(instance: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
  const { box, eventBus, options, frontendPath, frontendExists } = deps;

  if (!instance.openAccess || isHubMode()) {
    addBoxAuthHook(instance, box);
  }

  // Real-time updates run over the tRPC WebSocket (events.subscribe), which
  // starts the box file watcher itself. The schema watcher, by contrast, must
  // run whether or not a UI is connected (a headless server still serves cards
  // that need up-to-date box schemas), so start it here at registration. Close
  // both on shutdown.
  await ensureSchemaWatcher(box.boxRoot);
  instance.addHook("onClose", async () => {
    await closeBoxWatcher(box.boxRoot);
    await closeSchemaWatcher(box.boxRoot);
  });

  // Mount tRPC router alongside REST routes. `useWSS` adds a WebSocket
  // endpoint at the same prefix (GET upgrade on `/api/trpc`) that multiplexes
  // subscriptions over one connection — the transport behind real-time chat.
  // @fastify/websocket is registered once at the root (server.ts); the box
  // auth preHandler and this createContext apply to the upgrade too.
  //
  // `keepAlive` is read by the WS handler at runtime but omitted from the
  // adapter's option type (a tRPC types gap). Assigning trpcOptions via a const
  // rather than an inline literal lets the supported extra property through
  // without a cast (excess-property checks fire only on inline literals).
  const trpcOptions = {
    router: appRouter,
    // Without this, an error sent to the client (especially over the WS,
    // where there's no HTTP access log) leaves no server-side trace at all —
    // the "Duplicate id N" protocol error hid this way for days.
    onError: ({ error, type, path }: { error: Error; type: string; path?: string | undefined }) => {
      console.error(`[trpc] ${type} ${path ?? "<protocol>"} failed: ${error.message}`);
    },
    // Let the client send a read-only query over POST (input in the body
    // instead of the URL). files.summarize carries a large path list that
    // overflows the GET URL limit; the client routes it via POST. Queries
    // don't mutate, so relaxing the GET-only check adds no CSRF surface.
    allowMethodOverride: true,
    // Server-side heartbeat: ping idle WS clients and drop ones that don't
    // pong, freeing sockets held by crashed/NAT-dropped tabs.
    keepAlive: { enabled: true, pingMs: 30_000, pongWaitMs: 5_000 },
    createContext: async ({ req }: CreateFastifyContextOptions): Promise<TrpcContext> => {
      // Extract identity via the SAME helper the box auth preHandler uses
      // (`resolveRequestIdentity` — see auth.ts), so tRPC procedures gate on
      // exactly what the preHandler already decided, never a second,
      // independently-computed answer. The preHandler already rejected
      // unauthorized requests before this runs when auth is enabled; we
      // recompute here to fail closed rather than assume it ran (e.g. the
      // WS upgrade path shares this same createContext).
      const identity = await resolveBoxIdentity({
        boxRoot: box.boxRoot,
        request: req,
        openAccess: instance.openAccess,
      });
      const bearerOk = verifyAgentBearer(box.boxRoot, req.headers["authorization"]);
      const mobileOk = (await resolveMobileRequestAuth(box.boxRoot, req.headers)) !== null;
      // The browse key must be recognized HERE too, not only in the preHandler:
      // a request it let through would otherwise reach a protected procedure
      // with `authed: false`, so the credential would open every public read
      // and nothing else — and the WS path has no preHandler at all, so this is
      // the only place it can be checked there. On a box that opted in, the
      // resolver above already turned it into a `user`; this flag is what keeps
      // the OTHER box — the one that never opted in — reaching `authed`, and
      // what carries it past a credential-store outage below.
      const browseOk = verifyBrowseKey(req.headers);
      // Fail closed on a corrupt/unreadable credential store (Track D): never
      // build an authed context off an auth store we couldn't verify against.
      // For HTTP the box preHandler already answered 503 before this ran; this
      // is the fail-closed twin for the WS upgrade, which shares this context.
      // Agent- and mobile-authenticated requests don't consult that store, so
      // they stay valid through a store outage (matching the preHandler order).
      if (identity.source === "unavailable" && !bearerOk && !mobileOk && !browseOk) {
        throw new AuthStoreUnavailableAtContextError();
      }
      // One openness signal: the resolver returns `source: "open"` both in
      // hub-wide open mode AND in standalone open access (the `openAccess`
      // construction option), so this reads it instead of re-deriving from the
      // gate (principle #8).
      const identityIsOpen = identity.source === "open";
      const user = identity.email ? { email: identity.email, name: identity.name ?? identity.email } : null;
      return {
        boxRoot: box.boxRoot,
        boxSlug: box.slug,
        eventBus,
        services: options.services ?? {},
        user,
        // The browse key still grants bare `authed` on a box that did NOT opt
        // in — it is a machine credential there, not a person. On a box that
        // did, the resolver already produced `user`, so it arrives as an
        // identity like any other.
        authed: identityIsOpen || user !== null || bearerOk || mobileOk || browseOk,
        isOwner: identityIsOpen || (user !== null && user.email === getOwnerEmail()),
        // Deliberately NOT folding in open access, and deliberately excluding
        // `source: "browse"`: the machine-level secret store is shared across
        // every box on the machine, so neither "this box opted out of the auth
        // wall" nor "this box lets agent browsing act as its owner" may read as
        // "the boxholder is here" (`docs/implemented-plans/secret-custody.md`).
        isAuthenticatedOwner:
          user !== null && identity.source !== "browse" && user.email === getOwnerEmail(),
      };
    },
  };
  await instance.register(fastifyTRPCPlugin<typeof appRouter>, {
    prefix: "/api/trpc",
    useWSS: true,
    trpcOptions,
  });

  // Raw routes that can't move to tRPC (byte streaming, file uploads, WebSocket)
  const devSurfaces = options.devSurfaces === true;
  await registerApiRoutes(instance, { boxRoot: box.boxRoot, eventBus, devSurfaces });
  await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerHistoryRoutes(instance, box.boxRoot);
  await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio, prewarmChat: options.prewarmChat, chatBackend: options.chatBackend, devSurfaces });
  registerPairingRoutes(instance, { boxRoot: box.boxRoot, boxSlug: box.slug });
  // Box admin (telegram/google/box-config) now lives in the `admin` tRPC router
  // behind ownerProcedure; only the OAuth redirect callback stays a raw route
  // (registered at the root, see server.ts).
  await registerCaptureRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  // The loopback secret resolver. It sits in the box scope like every other
  // route, but does its OWN auth: the box auth hook above accepts five
  // credentials and this interface accepts exactly one of them (the agent
  // bearer), because it is the only one that discloses a stored value.
  registerSecretsRoutes({ server: instance, boxRoot: box.boxRoot, boxSlug: box.slug });
  await registerBulkUploadRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerViewRoutes({ server: instance, boxRoot: box.boxRoot });
  registerFigureRoutes({ server: instance, boxRoot: box.boxRoot });
  // The box's own icon and manifest, ahead of the static mount below so the
  // fleet-wide files don't shadow them.
  registerBoxIdentityAssetRoutes(instance, { boxRoot: box.boxRoot, boxSlug: box.slug, frontendPath });

  // Serve static frontend files within this prefix
  if (frontendExists) {
    await instance.register(fastifyStatic, {
      root: frontendPath,
      prefix: "/",
      wildcard: true,
      decorateReply: false, // Avoid duplicate decorator across box prefixes
    });
  }
}

/**
 * Register a box on the server: its main scope under `/<slug>` and its
 * webhook scope under `/webhook/<slug>` (outside the auth wall).
 */
export async function registerBox(server: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
  const { box, eventBus } = deps;

  await server.register(async (instance) => {
    await registerBoxRoutes(instance, deps);
  }, { prefix: `/${box.slug}` });

  // The scan upload routes mount under the SAME `/<slug>` prefix but in their
  // own sibling scope, deliberately outside `addBoxAuthHook`: that hook runs
  // before every route in the box scope and knows nothing of scan tokens, so a
  // scan bearer would be 401'd there before reaching a handler. This scope
  // installs `makeScanAuthPreHandler` instead — the ONLY gate that reads the
  // scan-token store — which is what confines that credential to these two
  // routes. Do not fold this back into registerBoxRoutes.
  await server.register(async (instance) => {
    await registerScanUploadRoutes({ server: instance, boxRoot: box.boxRoot });
  }, { prefix: `/${box.slug}` });

  // Register webhooks at /webhook/<slug>/ — outside auth so external
  // services (Telegram, etc.) can reach them without Cloudflare Access.
  // Shares the same EventBus as the main routes above.
  await server.register(async (instance) => {
    await registerTelegramRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  }, { prefix: `/webhook/${box.slug}` });
}
