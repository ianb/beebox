/**
 * Web app server - combined frontend + runner
 *
 * This is the central piece for MVP:
 * - Frontend for visibility (view cards, answer questions, trigger runs)
 * - Runner for event handling (timers, webhooks, agent spawning)
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import * as path from "node:path";
import * as fs from "node:fs";
import { registerApiRoutes } from "./routes/api.js";
import { registerSseRoutes } from "./routes/sse.js";
import { registerActionRoutes } from "./routes/actions.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerEditionRoutes } from "./routes/editions.js";
import { requireBoxRoot } from "../cli/lib/paths.js";

export const DEFAULT_PORT = 3210;

export interface ServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  boxRoot?: string | undefined;
}

export interface ServerContext {
  boxRoot: string;
  server: FastifyInstance;
}

/**
 * Create and configure the Fastify server.
 */
export async function createServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const boxRoot = options.boxRoot ?? await requireBoxRoot();

  const server = Fastify({
    logger: {
      level: "warn", // Only log warnings and errors
    },
  });

  // Store box root in server decorator
  server.decorate("boxRoot", boxRoot);

  // Register multipart for file uploads
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max for audio files
    },
  });

  // Register routes
  await registerApiRoutes(server, boxRoot);
  await registerSseRoutes(server, boxRoot);
  await registerActionRoutes(server, boxRoot);
  await registerCommandRoutes(server, boxRoot);
  await registerEditionRoutes(server, boxRoot);

  // Serve static frontend files (in production)
  // Path from dist/webapp/ to src/frontend/dist
  const frontendPath = path.join(import.meta.dirname, "../../src/frontend/dist");
  const frontendExists = fs.existsSync(path.join(frontendPath, "index.html"));

  if (frontendExists) {
    await server.register(fastifyStatic, {
      root: frontendPath,
      prefix: "/",
      wildcard: true,
    });

    // SPA fallback - serve index.html for non-API, non-asset routes
    server.setNotFoundHandler(async (request, reply) => {
      // Don't serve index.html for API routes or static asset files
      const url = request.url;
      if (url.startsWith("/api/") || url.startsWith("/assets/")) {
        return reply.status(404).send({ error: "Not found" });
      }
      // Check for actual asset file extensions (not .card paths which are SPA routes)
      const assetExtensions = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)$/i;
      if (assetExtensions.test(url)) {
        return reply.status(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    // Frontend not built yet, show dev placeholder
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
    pre { background: #f4f4f4; padding: 1rem; border-radius: 5px; overflow-x: auto; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Callback Box</h1>
  <p>The frontend is not built yet. Run <code>npm run build:frontend</code> to build it.</p>
  <h2>API Endpoints</h2>
  <ul>
    <li><a href="/api/status">/api/status</a> - System state</li>
    <li><a href="/api/inbox">/api/inbox</a> - Inbox items</li>
    <li><a href="/api/questions">/api/questions</a> - Questions</li>
    <li><a href="/api/commands">/api/commands</a> - Commands</li>
    <li><a href="/api/log">/api/log</a> - Recent activity</li>
    <li>/api/events - SSE stream</li>
  </ul>
  <h2>Box Root</h2>
  <pre>${boxRoot}</pre>
</body>
</html>
      `);
    });
  }

  return server;
}

/**
 * Start the server.
 */
export async function startServer(options: ServerOptions = {}): Promise<void> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? "localhost";

  const server = await createServer(options);

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    try {
      await server.close();
      console.log("Server closed.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    await server.listen({ port, host });
    console.log(`Server running at http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Allow running directly
if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, "") ?? "")) {
  startServer();
}
