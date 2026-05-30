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
import { createEventBus } from "../core/event-bus.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSystemAdminRoutes, registerGoogleServicesCallback } from "./routes/admin.js";
import { isAuthEnabled } from "./auth.js";
import { registerBoxPublicUrl } from "../core/script-env.js";
import type { ServerOptions } from "./server-types.js";
import { resolveBoxes, killPreviousServer } from "./server-lifecycle.js";
import { registerBox } from "./server-box-scope.js";
import {
  registerChromeExtensionCors,
  registerRootInfoRoutes,
  registerSpaFallback,
  registerUnbuiltFrontendRoot,
} from "./server-root.js";

export type { BoxSpec, ServerOptions, ServerContext } from "./server-types.js";

export const DEFAULT_PORT = 3210;

/**
 * Create and configure the Fastify server.
 */
export async function createServer(options?: ServerOptions): Promise<FastifyInstance> {
  options = options ?? {};
  const boxes = await resolveBoxes(options);

  const server = Fastify({
    logger: {
      level: "warn",
    },
    trustProxy: true,
    // tRPC batch requests encode multiple procedure names in the URL path,
    // which can exceed Fastify's default 100-char param length limit.
    routerOptions: { maxParamLength: 500 },
  });

  registerChromeExtensionCors(server);

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

  registerRootInfoRoutes(server, boxes);

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

    await registerBox(server, { box, eventBus, options, frontendPath, frontendExists });
  }

  if (frontendExists) {
    // SPA fallback — serve index.html for non-API, non-asset routes
    registerSpaFallback(server, frontendPath);
  } else {
    // Root redirect when frontend not built
    registerUnbuiltFrontendRoot(server, boxes);
  }

  return server;
}

/**
 * Start the server.
 */
export async function startServer(options?: ServerOptions): Promise<void> {
  options = options ?? {};
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "localhost";

  const boxes = await resolveBoxes(options);

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
