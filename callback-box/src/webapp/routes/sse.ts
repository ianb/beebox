/**
 * Server-Sent Events for live updates.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import { watch, type FSWatcher } from "chokidar";
import * as path from "node:path";

interface SSEClient {
  id: string;
  reply: FastifyReply;
}

let clients: SSEClient[] = [];
let watcher: FSWatcher | null = null;
let clientIdCounter = 0;

/**
 * Register SSE routes on the Fastify server.
 */
export async function registerSseRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  // Start file watcher if not already running
  if (!watcher) {
    const watchPath = path.join(boxRoot, "box");

    watcher = watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
      // Watch for card files and any files in box directories
      ignored: /(^|[/\\])\../,
    });

    watcher.on("all", (event, filePath) => {
      const relativePath = path.relative(boxRoot, filePath);
      broadcastEvent("file-change", {
        event,
        path: relativePath,
        timestamp: new Date().toISOString(),
      });
    });

    watcher.on("error", (error) => {
      console.error("File watcher error:", error);
    });
  }

  // GET /api/events - SSE endpoint
  server.get("/api/events", (request, reply) => {
    const clientId = `client-${++clientIdCounter}`;

    // Hijack the response - tells Fastify we're handling it ourselves
    reply.hijack();

    // Set SSE headers
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Send initial connection event
    sendEvent({ reply, event: "connected", data: { clientId } });

    // Add to clients list
    const client: SSEClient = { id: clientId, reply };
    clients.push(client);

    // Keep connection alive with periodic pings
    const pingInterval = setInterval(() => {
      if (reply.raw.writable) {
        sendEvent({ reply, event: "ping", data: { timestamp: new Date().toISOString() } });
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    // Remove client on close
    request.raw.on("close", () => {
      clients = clients.filter((c) => c.id !== clientId);
      clearInterval(pingInterval);
    });
  });

  // Cleanup on server close
  server.addHook("onClose", async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
    clients = [];
  });
}

/**
 * Parameters for sendEvent
 */
interface SendEventParams {
  reply: FastifyReply;
  event: string;
  data: unknown;
}

/**
 * Send an SSE event to a client.
 */
function sendEvent(params: SendEventParams): void {
  const { reply, event, data } = params;
  if (!reply.raw.writable) return;

  const payload = JSON.stringify(data);
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${payload}\n\n`);
}

/**
 * Broadcast an event to all connected clients.
 */
export function broadcastEvent(event: string, data: unknown): void {
  const payload = JSON.stringify(data);
  const message = `event: ${event}\ndata: ${payload}\n\n`;

  for (const client of clients) {
    if (client.reply.raw.writable) {
      client.reply.raw.write(message);
    }
  }
}

/**
 * Get the number of connected SSE clients.
 */
export function getClientCount(): number {
  return clients.length;
}
