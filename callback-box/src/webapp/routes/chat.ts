/**
 * Chat routes - Persistent conversational interface to a box's Claude agent.
 *
 * POST /api/chat/send     - Send message, stream response via SSE
 * GET  /api/chat/history   - Load conversation history
 * POST /api/chat/interrupt - Interrupt current turn
 * GET  /api/chat/status    - Check session status
 */

import type { FastifyInstance } from "fastify";
import { ChatSession, type ChatMessage } from "../../core/chat-session.js";
import type { BroadcastEventFn } from "./sse.js";

interface SendBody {
  message: string;
}

interface RegisterChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
}

/**
 * Register chat routes on the Fastify server.
 */
export async function registerChatRoutes(
  options: RegisterChatRoutesOptions
): Promise<void> {
  const { server, boxRoot, broadcastEvent } = options;
  // Create singleton ChatSession for this box
  const chatSession = new ChatSession(boxRoot);

  // POST /api/chat/send - Send a message and stream the response
  server.post<{ Body: SendBody }>(
    "/api/chat/send",
    async (request, reply) => {
      const body = request.body ?? {};
      const { message } = body;

      if (!message) {
        console.log("[chat:send] Missing message in body:", JSON.stringify(body));
        return reply.status(400).send({ error: "message is required" });
      }

      // Hijack the response from Fastify so we control the socket directly.
      // Without this, Fastify fires request.raw "close" immediately and
      // our event listeners get cleaned up before Claude responds.
      reply.hijack();

      // Set up SSE streaming
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // Check if busy
      if (chatSession.isBusy()) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "busy" })}\n\n`
        );
        reply.raw.end();
        return;
      }

      // Send the message and wait for the turn to complete.
      await new Promise<void>((resolve) => {
        const onMessage = (msg: ChatMessage) => {
          try {
            reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
          } catch {
            // Client disconnected
          }
        };

        const finish = () => {
          cleanup();
          reply.raw.end();
          resolve();
        };

        const onDone = () => {
          broadcastEvent("chat-complete", {
            timestamp: new Date().toISOString(),
          });
          finish();
        };

        const onError = (err: Error) => {
          try {
            reply.raw.write(
              `data: ${JSON.stringify({
                type: "error",
                error: err.message,
              })}\n\n`
            );
          } catch {
            // Client disconnected
          }
          finish();
        };

        const onClose = () => {
          finish();
        };

        const cleanup = () => {
          chatSession.removeListener("message", onMessage);
          chatSession.removeListener("done", onDone);
          chatSession.removeListener("error", onError);
          chatSession.removeListener("close", onClose);
        };

        chatSession.on("message", onMessage);
        chatSession.on("done", onDone);
        chatSession.on("error", onError);
        chatSession.on("close", onClose);

        // Handle client disconnect
        reply.raw.on("close", () => {
          cleanup();
          resolve();
        });

        // Send the message
        const sent = chatSession.send(message);
        if (!sent) {
          cleanup();
          reply.raw.write(
            `data: ${JSON.stringify({
              type: "error",
              error: "Failed to send message",
            })}\n\n`
          );
          reply.raw.end();
          resolve();
        }
      });
    }
  );

  // GET /api/chat/history - Load conversation history
  server.get("/api/chat/history", async () => {
    return chatSession.getHistory();
  });

  // POST /api/chat/interrupt - Interrupt current turn
  server.post("/api/chat/interrupt", async () => {
    chatSession.interrupt();
    return { ok: true };
  });

  // GET /api/chat/status - Check session status
  server.get("/api/chat/status", async () => {
    return {
      sessionId: chatSession.getSessionId(),
      running: chatSession.isRunning(),
      busy: chatSession.isBusy(),
    };
  });

  // POST /api/chat/reset - Reset session (start fresh)
  server.post("/api/chat/reset", async () => {
    chatSession.resetSession();
    return { ok: true };
  });
}
