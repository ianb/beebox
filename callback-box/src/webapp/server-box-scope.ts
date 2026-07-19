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
import { registerCaptureRoutes } from "./routes/capture.js";
import { isPairingRedeemUrl, registerPairingRoutes } from "./routes/pairing.js";
import { appRouter } from "./trpc/router.js";
import type { TrpcContext } from "./trpc/context.js";
import {
  authRequired,
  isHubMode,
  resolveRequestIdentity,
  getOwnerEmail,
  isDiagnosticBypassRequest,
} from "./auth.js";
import { verifyAgentBearer } from "../core/agent/token.js";
import { resolveMobileRequestAuth } from "../core/mobile/request-auth.js";
import { renewMobileSessionCookie } from "./mobile-cookie.js";
import { canAccessBox } from "./box-access.js";
import type { EventBus } from "../core/event-bus.js";
import { closeBoxWatcher } from "../core/box/file-watcher.js";
import { ensureSchemaWatcher, closeSchemaWatcher } from "../core/schema-watcher.js";
import type { BoxSpec, ServerOptions } from "./server-types.js";
import { invariant } from "../lib/invariant.js";

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

/** Exported for the hub (`src/hub/hub-server.ts`), which needs the same
 *  HTML-navigation-vs-API distinction when a proxied request is
 *  unauthenticated: API/WS gets 401, HTML navigation gets a login redirect. */
export function isApiUrl(url: string): boolean {
  return url.includes("/api/") || url.includes("/trpc/") || url.includes("/events");
}

/**
 * Per-box auth preHandler: verify identity and box-level access. Installed
 * whenever authentication is required (`authRequired()` — the always-on
 * default) OR this box is running behind a hub (`isHubMode()`); skipped only
 * in standalone open mode (the `CB_ALLOW_UNAUTHENTICATED` opt-out). Lets
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
    // Mobile devices authenticate with either the durable device token in an
    // Authorization header or the short-lived cb_mobile cookie; one resolver
    // decides for every gate (see core/mobile/request-auth.ts).
    const mobileAuth = resolveMobileRequestAuth(box.boxRoot, request.headers);
    if (mobileAuth) {
      renewMobileSessionCookie(reply, { boxRoot: box.boxRoot, boxSlug: box.slug, auth: mobileAuth });
      return;
    }
    const identity = resolveRequestIdentity(request);
    if (identity.source === "open") return; // hub-wide auth is off
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
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }
    if (!(await canAccessBox({ boxRoot: box.boxRoot, email, ownerEmail: getOwnerEmail() }))) {
      return reply.status(403).send({ error: "Not authorized for this box" });
    }
  });
}

interface BoxScopeDeps {
  box: BoxSpec;
  eventBus: EventBus;
  options: ServerOptions;
  frontendPath: string;
  frontendExists: boolean;
}

/**
 * Register the main per-box scope under `/<slug>`: auth hook, tRPC,
 * the REST routes that can't move to tRPC, box admin, and static frontend.
 */
async function registerBoxRoutes(instance: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
  const { box, eventBus, options, frontendPath, frontendExists } = deps;

  if (authRequired() || isHubMode()) {
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
    createContext: ({ req }: CreateFastifyContextOptions): TrpcContext => {
      // Extract identity via the SAME helper the box auth preHandler uses
      // (`resolveRequestIdentity` — see auth.ts), so tRPC procedures gate on
      // exactly what the preHandler already decided, never a second,
      // independently-computed answer. The preHandler already rejected
      // unauthorized requests before this runs when auth is enabled; we
      // recompute here to fail closed rather than assume it ran (e.g. the
      // WS upgrade path shares this same createContext).
      const identity = resolveRequestIdentity(req);
      // One openness signal: the resolver returns `source: "open"` both in
      // hub-wide open mode AND in standalone open mode (the
      // CB_ALLOW_UNAUTHENTICATED opt-out), so this reads it instead of
      // re-deriving from the gate (principle #8).
      const openAccess = identity.source === "open";
      const user = identity.email ? { email: identity.email, name: identity.name ?? identity.email } : null;
      const bearerOk = verifyAgentBearer(box.boxRoot, req.headers["authorization"]);
      const mobileOk = resolveMobileRequestAuth(box.boxRoot, req.headers) !== null;
      return {
        boxRoot: box.boxRoot,
        boxSlug: box.slug,
        eventBus,
        services: options.services ?? {},
        user,
        authed: openAccess || user !== null || bearerOk || mobileOk,
        isOwner: openAccess || (user !== null && user.email === getOwnerEmail()),
      };
    },
  };
  await instance.register(fastifyTRPCPlugin<typeof appRouter>, {
    prefix: "/api/trpc",
    useWSS: true,
    trpcOptions,
  });

  // Raw routes that can't move to tRPC (byte streaming, file uploads, WebSocket)
  await registerApiRoutes(instance, { boxRoot: box.boxRoot, eventBus });
  await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerHistoryRoutes(instance, box.boxRoot);
  await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio, prewarmChat: options.prewarmChat });
  registerPairingRoutes(instance, { boxRoot: box.boxRoot, boxSlug: box.slug });
  // Box admin (telegram/google/box-config) now lives in the `admin` tRPC router
  // behind ownerProcedure; only the OAuth redirect callback stays a raw route
  // (registered at the root, see server.ts).
  await registerCaptureRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerViewRoutes({ server: instance, boxRoot: box.boxRoot });
  registerFigureRoutes({ server: instance, boxRoot: box.boxRoot });

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

  // Register webhooks at /webhook/<slug>/ — outside auth so external
  // services (Telegram, etc.) can reach them without Cloudflare Access.
  // Shares the same EventBus as the main routes above.
  await server.register(async (instance) => {
    await registerTelegramRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  }, { prefix: `/webhook/${box.slug}` });
}
