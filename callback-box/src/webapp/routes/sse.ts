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

export type BroadcastEventFn = (event: string, data: unknown) => void;

export interface SseRouteResult {
  broadcastEvent: BroadcastEventFn;
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
 * Register SSE routes on the Fastify server.
 * Returns a broadcastEvent function scoped to this box's clients.
 */
export async function registerSseRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<SseRouteResult> {
  let clients: SSEClient[] = [];
  let watcher: FSWatcher | null = null;
  let clientIdCounter = 0;

  function broadcastEvent(event: string, data: unknown): void {
    const payload = JSON.stringify(data);
    const message = `event: ${event}\ndata: ${payload}\n\n`;

    for (const client of clients) {
      if (client.reply.raw.writable) {
        client.reply.raw.write(message);
      }
    }
  }

  // Start file watcher lazily on first SSE client connection
  const watchPath = path.join(boxRoot, "box");

  function ensureWatcher(): void {
    if (watcher) return;
    watcher = watch(watchPath, {
      persistent: true,
      ignoreInitial: true,
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

    ensureWatcher();

    reply.hijack();

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    sendEvent({ reply, event: "connected", data: { clientId } });

    const client: SSEClient = { id: clientId, reply };
    clients.push(client);

    const pingInterval = setInterval(() => {
      if (reply.raw.writable) {
        sendEvent({ reply, event: "ping", data: { timestamp: new Date().toISOString() } });
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

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

  return { broadcastEvent };
}
