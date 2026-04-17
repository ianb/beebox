/**
 * Web app server - combined frontend + runner
 *
 * Supports serving multiple boxes, each at its own URL prefix (slug).
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import fastifyWebsocket from "@fastify/websocket";
import fastifyCookie from "@fastify/cookie";
import * as path from "node:path";
import * as fs from "node:fs";
import { registerApiRoutes } from "./routes/api.js";
import { registerSseRoutes } from "./routes/sse.js";
import { createEventBus } from "../core/event-bus.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerBriefRoutes } from "./routes/briefs.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerSchedulerRoutes } from "./routes/scheduler.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerClerkRoutes } from "./routes/clerk.js";
import { registerViewRoutes } from "./routes/views.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSystemAdminRoutes, registerBoxAdminRoutes, registerGoogleServicesCallback } from "./routes/admin.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./trpc/router.js";
import type { TrpcContext } from "./trpc/context.js";
import { ChatSession } from "../core/chat-session.js";
import { isAuthEnabled, getSessionEmail, getOwnerEmail, isDiagnosticBypassRequest } from "./auth.js";
import { loadBoxConfig } from "./box-config.js";
import { registerBoxPublicUrl } from "../core/script-env.js";
import { requireBoxRoot } from "../cli/lib/paths.js";
import type { Services } from "../services/index.js";

export const DEFAULT_PORT = 3210;

export interface BoxSpec {
  slug: string;
  boxRoot: string;
}

export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  boxes?: BoxSpec[] | undefined;
  /** @deprecated Use boxes instead */
  boxRoot?: string | undefined;
  /** External service implementations — pass fakes in tests */
  services?: Services | undefined;
}

export interface ServerContext {
  boxRoot: string;
  server: FastifyInstance;
}

/**
 * Create and configure the Fastify server.
 */
export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  // Build boxes array from either boxes or legacy boxRoot
  let boxes: BoxSpec[];
  if (options.boxes && options.boxes.length > 0) {
    boxes = options.boxes;
  } else {
    const boxRoot = options.boxRoot ?? await requireBoxRoot();
    boxes = [{ slug: path.basename(boxRoot), boxRoot }];
  }

  const server = Fastify({
    logger: {
      level: "warn",
    },
    trustProxy: true,
    // tRPC batch requests encode multiple procedure names in the URL path,
    // which can exceed Fastify's default 100-char param length limit.
    maxParamLength: 500,
  });

  // eslint-disable-next-line max-params -- Fastify onSend hook requires 4 params
  server.addHook("onSend", (request, reply, payload, done) => {
    const origin = request.headers.origin;
    if (origin && origin.startsWith("chrome-extension://")) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Vary", "Origin");
    }
    done(null, payload);
  });

  server.options("/api/boxes", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin.startsWith("chrome-extension://")) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Access-Control-Allow-Credentials", "true");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
    }
    return reply
      .header("Access-Control-Allow-Methods", "GET,OPTIONS")
      .send();
  });

  // Register cookie support (used for auth sessions)
  await server.register(fastifyCookie);

  // Register multipart for file uploads
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max for audio files
    },
  });

  // Register WebSocket support (used by realtime transcription proxy)
  await server.register(fastifyWebsocket);

  // Register auth routes (login, callback, logout, me) when auth is enabled
  if (isAuthEnabled()) {
    await server.register(registerAuthRoutes, { boxes });
  }
  // System-wide admin routes (Claude Code auth)
  await server.register(async (instance) => {
    await registerSystemAdminRoutes(instance, options.services ?? {});
  });
  // Root-level Google Services OAuth callback (single redirect URI for all boxes)
  await server.register(async (instance) => {
    await registerGoogleServicesCallback(instance, { boxes });
  });

  // Build info — written by deploy.sh, shows what's deployed
  const deployInfoDir = path.join(import.meta.dirname, "../..");
  server.get("/api/build-info", async () => {
    try {
      const raw = fs.readFileSync(path.join(deployInfoDir, "deploy-info.json"), "utf-8");
      const current = JSON.parse(raw);
      let history: unknown[] = [];
      try {
        history = JSON.parse(fs.readFileSync(path.join(deployInfoDir, "deploy-history.json"), "utf-8"));
      } catch (_e) { /* no history yet */ }
      return { current, history };
    } catch (_e) {
      return { error: "No deploy info available" };
    }
  });

  // Root-level box list endpoint (filtered by user access when auth enabled)
  server.get("/api/boxes", async (request) => {
    if (isAuthEnabled()) {
      const email = getSessionEmail(request);
      if (!email) {
        return { boxes: [], authRequired: true };
      }
      const ownerEmail = getOwnerEmail();
      const accessible: Array<{ slug: string; name: string }> = [];
      for (const b of boxes) {
        if (email === ownerEmail) {
          accessible.push({ slug: b.slug, name: b.slug });
        } else {
          const config = await loadBoxConfig(b.boxRoot);
          // Only show boxes where user is explicitly allowed
          if (config.allowedEmails?.length && config.allowedEmails.includes(email)) {
            accessible.push({ slug: b.slug, name: b.slug });
          }
        }
      }
      return { boxes: accessible };
    }
    return { boxes: boxes.map((b) => ({ slug: b.slug, name: b.slug })) };
  });

  // Path from dist/webapp/ to src/frontend/dist
  const frontendPath = path.join(import.meta.dirname, "../../src/frontend/dist");
  const frontendExists = fs.existsSync(path.join(frontendPath, "index.html"));

  // Serve static frontend assets at root level (for the box selector page at /)
  if (frontendExists) {
    await server.register(fastifyStatic, {
      root: frontendPath,
      prefix: "/",
      wildcard: true,
    });
  }

  // Register each box under its slug prefix
  for (const box of boxes) {
    // One EventBus per box — shared by main routes and webhook routes
    const eventBus = createEventBus(box.boxRoot, { pollInterval: 1000 });
    eventBus.prune(new Date(Date.now() - 24 * 60 * 60 * 1000));

    await server.register(async (instance) => {
      // Per-box auth check: verify session and box-level access
      if (isAuthEnabled()) {
        instance.addHook("preHandler", async (request, reply) => {
          // Let static assets through (handled by fastify-static)
          if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i.test(request.url)) {
            return;
          }
          // Diagnostic API key bypass for read-only debug/health endpoints
          if (isDiagnosticBypassRequest(request)) {
            return;
          }
          const email = getSessionEmail(request);
          if (!email) {
            // For API/SSE requests, return 401 JSON. For page navigations, redirect to login.
            const isApi = request.url.includes("/api/") || request.url.includes("/trpc/") || request.url.includes("/events");
            if (isApi) {
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

      const chatSession = new ChatSession(box.boxRoot);

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
            chatSession,
          }),
        },
      });

      // REST routes that can't move to tRPC (SSE streaming, file uploads, WebSocket)
      await registerApiRoutes(instance, { boxRoot: box.boxRoot, eventBus });
      await registerActionRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
      await registerCommandRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
      await registerBriefRoutes(instance, box.boxRoot);
      await registerHistoryRoutes(instance, box.boxRoot);
      await registerCalendarRoutes({ server: instance, boxRoot: box.boxRoot, calendar: options.services?.calendar });
      await registerSchedulerRoutes(instance, box.boxRoot);
      await registerChatRoutes({ server: instance, boxRoot: box.boxRoot, eventBus, openaiAudio: options.services?.openaiAudio });
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
    }, { prefix: `/${box.slug}` });

    // Register webhooks at /webhook/<slug>/ — outside auth so external
    // services (Telegram, etc.) can reach them without Cloudflare Access.
    // Shares the same EventBus as the main routes above.
    await server.register(async (instance) => {
      await registerTelegramRoutes({ server: instance, boxRoot: box.boxRoot, eventBus });
    }, { prefix: `/webhook/${box.slug}` });
  }

  if (frontendExists) {
    // SPA fallback — serve index.html for non-API, non-asset routes
    server.setNotFoundHandler(async (request, reply) => {
      const url = request.url;

      // Don't serve index.html for root-level API
      if (url === "/api/boxes") {
        return reply.status(404).send({ error: "Not found" });
      }

      // Check if this looks like a static asset request
      const assetExtensions = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;
      if (assetExtensions.test(url)) {
        return reply.status(404).send({ error: "Not found" });
      }

      // For API routes under box slugs that weren't matched
      if (/^\/[^/]+\/api\//.test(url)) {
        return reply.status(404).send({ error: "Not found" });
      }

      // Auth wall: if auth is enabled and user isn't logged in, redirect to login
      // (except for root "/" which shows its own login UI, and /auth/* routes)
      if (isAuthEnabled() && url !== "/" && !url.startsWith("/auth/") && !url.startsWith("/share")) {
        const email = getSessionEmail(request);
        if (!email) {
          return reply.redirect(`/auth/login?returnTo=${encodeURIComponent(url)}`);
        }
      }

      // SPA fallback: serve index.html
      return reply.type("text/html").send(
        fs.readFileSync(path.join(frontendPath, "index.html"), "utf-8")
      );
    });
  } else {
    // Root redirect when frontend not built
    server.get("/", async (_request, reply) => {
      return reply.type("text/html").send(`
<!DOCTYPE html>
<html>
<head>
  <title>Callback Box</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #333; }
    code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Callback Box</h1>
  <p>The frontend is not built yet. Run <code>npm run build:frontend</code> to build it.</p>
  <h2>Boxes</h2>
  <ul>
    ${boxes.map((b) => `<li><a href="/${b.slug}/">${b.slug}</a> — ${b.boxRoot}</li>`).join("\n    ")}
  </ul>
</body>
</html>
      `);
    });
  }

  return server;
}

/**
 * Kill any previous server process using the PID file.
 */
async function killPreviousServer(pidFile: string): Promise<void> {
  try {
    const pidStr = await fs.promises.readFile(pidFile, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (isNaN(pid)) return;

    try {
      // Check if process is alive (signal 0 doesn't kill, just checks)
      process.kill(pid, 0);
      console.log(`Killing previous server (PID ${pid})...`);
      process.kill(pid, "SIGTERM");
      // Give it a moment to shut down
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        process.kill(pid, 0);
        // Still alive, force kill
        console.log(`Force killing previous server (PID ${pid})...`);
        process.kill(pid, "SIGKILL");
      } catch {
        // Already dead, good
      }
    } catch {
      // Process doesn't exist, stale PID file
    }

    await fs.promises.unlink(pidFile).catch(() => {});
  } catch {
    // No PID file, nothing to do
  }
}

/**
 * Start the server.
 */
export async function startServer(options: ServerOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "localhost";

  // Build boxes from options
  let boxes: BoxSpec[];
  if (options.boxes && options.boxes.length > 0) {
    boxes = options.boxes;
  } else {
    const boxRoot = options.boxRoot ?? await requireBoxRoot();
    boxes = [{ slug: path.basename(boxRoot), boxRoot }];
  }

  // Kill previous server for each box
  for (const box of boxes) {
    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
    await killPreviousServer(pidFile);
  }

  const server = await createServer({ ...options, boxes });

  // Write PID file to each box
  const pidFiles: string[] = [];
  for (const box of boxes) {
    const pidFile = path.join(box.boxRoot, ".cb-serve.pid");
    await fs.promises.writeFile(pidFile, String(process.pid));
    pidFiles.push(pidFile);
  }

  // Shutdown handler — force-close all connections immediately so
  // --watch restarts don't hang on open SSE/WebSocket sockets.
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    for (const pf of pidFiles) {
      await fs.promises.unlink(pf).catch(() => {});
    }
    server.server.closeAllConnections();
    await server.close();
    console.log("Server closed.");
    process.exit(0);
  };

  // Handle termination signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));

  try {
    await server.listen({ port, host });
    // Register live public URLs for each served box so subprocess spawns
    // pick up CB_BOX_NAME / CB_SERVER_URL via buildScriptEnv without
    // requiring publicUrl to be set in config/box.json.
    for (const box of boxes) {
      registerBoxPublicUrl(box.boxRoot, `http://${host}:${port}/${box.slug}`);
    }
    console.log(`Server running at http://${host}:${port}`);
    for (const box of boxes) {
      console.log(`  ${box.slug}: http://${host}:${port}/${box.slug}/`);
    }
  } catch (err) {
    for (const pf of pidFiles) {
      await fs.promises.unlink(pf).catch(() => {});
    }
    server.log.error(err);
    process.exit(1);
  }

  // Orphan detection: if our parent process dies (ppid becomes 1),
  // shut down gracefully instead of becoming a zombie.
  const initialPpid = process.ppid;
  if (initialPpid !== 1) {
    const orphanCheck = setInterval(() => {
      if (process.ppid !== initialPpid) {
        console.log(`Parent process died (was ${initialPpid}, now ${process.ppid}), shutting down.`);
        clearInterval(orphanCheck);
        shutdown("orphan-detection");
      }
    }, 2000);
    orphanCheck.unref();
  }
}

// Allow running directly: node --import tsx ./src/webapp/server.ts [boxDirs...]
// Supports PORT and HOST env vars (standard Procfile convention).
if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, "") ?? "")) {
  const dirs = process.argv.slice(2);
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const host = process.env.HOST || undefined;

  const boxes: BoxSpec[] | undefined =
    dirs.length > 0
      ? dirs.map((dir) => {
          const boxRoot = path.resolve(dir);
          return { slug: path.basename(boxRoot), boxRoot };
        })
      : undefined;

  startServer({ port, host, boxes });
}
