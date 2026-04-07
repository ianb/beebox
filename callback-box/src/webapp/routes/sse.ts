/**
 * Server-Sent Events for live updates.
 *
 * Thin adapter over EventBus — subscribes each SSE client to the bus
 * with Last-Event-ID replay for reconnecting clients.
 */

import type { FastifyInstance } from "fastify";
import { watch, type FSWatcher } from "chokidar";
import * as path from "node:path";
import type { EventBus } from "../../core/event-bus.js";

interface RegisterSseRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
}

/**
 * Register SSE routes on the Fastify server.
 * Uses EventBus for event dispatch and replay.
 */
export async function registerSseRoutes(opts: RegisterSseRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus } = opts;
  let watcher: FSWatcher | null = null;

  // Start file watcher lazily on first SSE client connection
  const watchPaths = [path.join(boxRoot, "box"), path.join(boxRoot, "views")];

  function ensureWatcher(): void {
    if (watcher) return;
    watcher = watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      ignored: /(^|[/\\])\../,
    });

    watcher.on("all", (fsEvent, filePath) => {
      const relativePath = path.relative(boxRoot, filePath);
      eventBus.emitTransient("file-change", {
        event: fsEvent,
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
    // Support Last-Event-ID from header (browser auto-reconnect) or query param (our state machine)
    const query = request.query as Record<string, string>;
    const lastEventId = Number(request.headers["last-event-id"]) || Number(query.lastEventId) || 0;

    ensureWatcher();

    reply.hijack();

    // In dev mode the frontend connects directly to Fastify (port 3211)
    // from Vite (port 3210), so we need CORS headers on the hijacked response.
    const origin = request.headers.origin;
    const headers: Record<string, string> = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Disable nginx/proxy buffering so events stream immediately
      "X-Accel-Buffering": "no",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    reply.raw.writeHead(200, headers);

    // Send an immediate connected event so the client knows the stream is live.
    // Without this, EventSource.onopen may not fire until the first real event
    // or ping (up to 30s), leaving the UI showing "disconnected".
    reply.raw.write(`event: connected\ndata: {"timestamp":"${new Date().toISOString()}"}\n\n`);

    // Subscribe to EventBus — replays missed events, then streams live
    const sub = eventBus.subscribe({
      afterId: lastEventId,
      listener: (busEvent) => {
        if (!reply.raw.writable) return;
        // Use event ID for persistent events; skip id: for transient (negative ID)
        const idLine = busEvent.id > 0 ? `id: ${busEvent.id}\n` : "";
        const payload = JSON.stringify(busEvent.data);
        reply.raw.write(`${idLine}event: ${busEvent.event}\ndata: ${payload}\n\n`);
      },
    });

    const pingInterval = setInterval(() => {
      if (reply.raw.writable) {
        const payload = JSON.stringify({ timestamp: new Date().toISOString() });
        reply.raw.write(`event: ping\ndata: ${payload}\n\n`);
      } else {
        clearInterval(pingInterval);
      }
    }, 30000);

    request.raw.on("close", () => {
      sub.unsubscribe();
      clearInterval(pingInterval);
    });
  });

  // Cleanup on server close
  server.addHook("onClose", async () => {
    if (watcher) {
      await watcher.close();
      watcher = null;
    }
  });
}
