/**
 * Per-box route registration for the web app server.
 *
 * Each box is mounted under its slug prefix (main routes + tRPC + static)
 * and its webhooks are mounted under /webhook/<slug> outside the auth wall.
 * Split out of server.ts to keep that file under its line budget.
 */

import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { registerApiRoutes } from "./routes/api.js";
import { registerSseRoutes } from "./routes/sse.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerSchedulerRoutes } from "./routes/scheduler.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerClerkRoutes } from "./routes/clerk.js";
import { registerViewRoutes } from "./routes/views.js";
import { registerBoxAdminRoutes } from "./routes/admin.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { appRouter } from "./trpc/router.js";
import type { TrpcContext } from "./trpc/context.js";
import { isAuthEnabled, getSessionEmail, getOwnerEmail, isDiagnosticBypassRequest } from "./auth.js";
import { loadBoxConfig } from "./box-config.js";
import type { EventBus } from "../core/event-bus.js";
import type { BoxSpec, ServerOptions } from "./server-types.js";

const ASSET_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;

function isApiUrl(url: string): boolean {
  return url.includes("/api/") || url.includes("/trpc/") || url.includes("/events");
}

/**
 * Per-box auth preHandler: verify session and box-level access. Installed
 * only when auth is enabled. Lets static assets and diagnostic-bypass
 * requests through; redirects page navigations to login and 401s API calls.
 */
function addBoxAuthHook(instance: FastifyInstance, box: BoxSpec): void {
  instance.addHook("preHandler", async (request, reply) => {
    // Let static assets (served by fastify-static) through. Scope this
    // narrowly: API/SSE paths (like /api/files/foo.jpg) need the auth
    // check even when they end in an asset extension.
    const urlPath = request.url.split("?")[0]!;
    if (!isApiUrl(urlPath) && ASSET_EXTENSIONS.test(urlPath)) {
      return;
    }
    // Diagnostic API key bypass for read-only debug/health endpoints
    if (isDiagnosticBypassRequest(request)) {
      return;
    }
    const email = getSessionEmail(request);
    if (!email) {
      // For API/SSE requests, return 401 JSON. For page navigations, redirect to login.
      if (isApiUrl(request.url)) {
        return reply.status(401).send({ error: "Not authenticated" });
      }
      return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(request.url)}`);
    }
    const ownerEmail = getOwnerEmail();
    if (email !== ownerEmail) {
      const config = await loadBoxConfig(box.boxRoot);
      // If no allowedEmails configured, only the owner can access
      if (!config.allowedEmails?.length || !config.allowedEmails.includes(email)) {
        return reply.status(403).send({ error: "Not authorized for this box" });
      }
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
 * Register the main per-box scope under `/<slug>`: auth hook, SSE, tRPC,
 * the REST routes that can't move to tRPC, box admin, and static frontend.
 */
async function registerBoxRoutes(instance: FastifyInstance, deps: BoxScopeDeps): Promise<void> {
  const { box, eventBus, options, frontendPath, frontendExists } = deps;

  if (isAuthEnabled()) {
    addBoxAuthHook(instance, box);
  }

  // Register SSE route (subscribes clients to EventBus)
  await registerSseRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });

  // Mount tRPC router alongside REST routes
  await instance.register(fastifyTRPCPlugin<typeof appRouter>, {
    prefix: "/api/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: (): TrpcContext => ({
        boxRoot: box.boxRoot,
        boxSlug: box.slug,
        eventBus,
        services: options.services ?? {},
      }),
    },
  });

  // REST routes that can't move to tRPC (SSE streaming, file uploads, WebSocket)
  await registerApiRoutes(instance, { boxRoot: box.boxRoot, eventBus });
  await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
  await registerHistoryRoutes(instance, box.boxRoot);
  await registerCalendarRoutes({ server: instance, boxRoot: box.boxRoot, calendar: options.services?.calendar });
  await registerSchedulerRoutes(instance, box.boxRoot);
  await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio, prewarmChat: options.prewarmChat });
  // Wrap box admin routes in their own sub-scope so the owner-check
  // preHandler (added by addOwnerCheck inside registerBoxAdminRoutes)
  // is encapsulated to /api/admin/* only, not every per-box route.
  // Without this sub-scope, the owner check bleeds out over the whole
  // per-box instance and makes allowedEmails dead code (anyone who
  // isn't the owner would be rejected by addOwnerCheck on any request).
  // Mirrors the pattern used for registerSystemAdminRoutes at the root.
  await instance.register(async (adminScope) => {
    await registerBoxAdminRoutes(adminScope, { boxRoot: box.boxRoot, boxSlug: box.slug, services: options.services ?? {} });
  });
  await registerCaptureRoutes({ server: instance, boxRoot: box.boxRoot, boxSlug: box.slug, eventBus });
  await registerClerkRoutes({ server: instance, boxRoot: box.boxRoot });
  await registerViewRoutes({ server: instance, boxRoot: box.boxRoot });

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
