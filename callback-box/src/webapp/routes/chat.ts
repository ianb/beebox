/**
 * Chat routes - Persistent conversational interface to a box's Claude agent.
 *
 * POST /api/chat/send     - Send message, stream response via SSE
 * GET  /api/chat/history   - Load conversation history
 * POST /api/chat/interrupt - Interrupt current turn
 * GET  /api/chat/status    - Check session status
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky from "ky";
import type { FastifyInstance } from "fastify";
import { ChatSession, type ChatMessage } from "../../core/chat-session.js";
import { WebSocket as WsWebSocket } from "ws";
import type { BroadcastEventFn } from "./sse.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";
import {
  listSessions,
  getSessionLogPath,
  parseSessionLog,
} from "../../cli/lib/session.js";

interface SendBody {
  message: string;
}

interface RegisterChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  broadcastEvent: BroadcastEventFn;
  openaiAudio?: OpenAIAudioService | undefined;
}

/**
 * Register chat routes on the Fastify server.
 */
export async function registerChatRoutes(
  options: RegisterChatRoutesOptions
): Promise<void> {
  const { server, boxRoot, broadcastEvent, openaiAudio } = options;
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
  // Optional ?session=<id> to view any session's history (read-only)
  server.get<{ Querystring: { session?: string } }>("/api/chat/history", async (request) => {
    const sessionId = request.query.session;
    if (!sessionId) {
      return chatSession.getHistory();
    }
    // Load from JSONL file directly
    const logPath = getSessionLogPath(boxRoot, sessionId);
    try {
      const { entries } = await parseSessionLog({ logPath });
      return { sessionId, entries };
    } catch (_e) {
      return { sessionId, entries: [] };
    }
  });

  // GET /api/chat/sessions - List all known sessions with metadata
  server.get("/api/chat/sessions", async () => {
    const activeSessionId = chatSession.getSessionId();

    // Source 1: Interactive chat session
    const knownSessions = new Map<string, { source: string; label: string; lastUsedAt: string; isActive: boolean }>();
    if (activeSessionId) {
      knownSessions.set(activeSessionId, {
        source: "chat",
        label: "Chat",
        lastUsedAt: new Date().toISOString(),
        isActive: true,
      });
    }

    // Source 2: Telegram thread sessions
    const threadSessionsPath = path.join(boxRoot, ".callback-box/chat-thread-sessions.json");
    try {
      const data = await fs.readFile(threadSessionsPath, "utf-8");
      const threadSessions = JSON.parse(data) as Record<string, { sessionId: string; lastUsedAt: string; messageCount: number }>;
      for (const [threadRef, record] of Object.entries(threadSessions)) {
        if (!knownSessions.has(record.sessionId)) {
          // Extract a label from the thread ref (e.g., "box/inbox/telegram/family-group/thread.chat.card" → "telegram/family-group")
          const parts = threadRef.split("/");
          const telegramIdx = parts.indexOf("telegram");
          const label = telegramIdx !== -1 ? parts.slice(telegramIdx + 1, -1).join("/") || "Telegram" : threadRef;
          knownSessions.set(record.sessionId, {
            source: "telegram",
            label: `Telegram: ${label}`,
            lastUsedAt: record.lastUsedAt,
            isActive: false,
          });
        }
      }
    } catch (_e) {
      // No telegram sessions
    }

    // Source 3: Reactor chat sessions
    const reactorSessionsPath = path.join(boxRoot, ".callback-box/chat-sessions.json");
    try {
      const data = await fs.readFile(reactorSessionsPath, "utf-8");
      const reactorSessions = JSON.parse(data) as Record<string, { sessionId: string; lastUsedAt: string; messageCount: number }>;
      for (const [threadRef, record] of Object.entries(reactorSessions)) {
        if (!knownSessions.has(record.sessionId)) {
          knownSessions.set(record.sessionId, {
            source: "reactor",
            label: `Reactor: ${threadRef}`,
            lastUsedAt: record.lastUsedAt,
            isActive: false,
          });
        }
      }
    } catch (_e) {
      // No reactor sessions
    }

    // Source 4: All JSONL files (catches sessions not tracked above)
    const allSessions = await listSessions(boxRoot);
    for (const s of allSessions) {
      if (!knownSessions.has(s.sessionId)) {
        knownSessions.set(s.sessionId, {
          source: "unknown",
          label: s.sessionId.slice(0, 12),
          lastUsedAt: s.mtime.toISOString(),
          isActive: false,
        });
      }
    }

    // Sort by lastUsedAt descending
    const sessions = [...knownSessions.entries()]
      .map(([sessionId, meta]) => ({ sessionId, ...meta }))
      .toSorted((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());

    return { sessions };
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

  // GET /api/chat/voice-config - Return speaking voice config from personality
  server.get("/api/chat/voice-config", async (_request, _reply) => {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const voicePath = join(boxRoot, "docs/generated/speaking-voice.json");
      const content = await readFile(voicePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { model: undefined, instructions: [] };
    }
  });

  // POST /api/chat/tts - Proxy TTS requests to OpenAI
  const VALID_TTS_VOICES = [
    "alloy", "ash", "ballad", "cedar", "coral", "echo",
    "fable", "marin", "onyx", "nova", "sage", "shimmer", "verse",
  ];

  server.post<{ Body: { text: string; instructions?: string; voice?: string } }>(
    "/api/chat/tts",
    async (request, reply) => {
      const { text, instructions, voice } = request.body;
      const resolvedVoice = voice && VALID_TTS_VOICES.includes(voice) ? voice : "marin";

      if (openaiAudio) {
        // Use injected service (tests or explicit config)
        const ttsOpts: { voice?: string; instructions?: string } = { voice: resolvedVoice };
        if (instructions) ttsOpts.instructions = instructions;
        const result = await openaiAudio.textToSpeech(text, ttsOpts);
        reply.header("Content-Type", result.contentType);
        return reply.send(result.audio);
      }

      // Fallback: direct API call
      const apiKey = process.env.THINKING_OPENAI_API_KEY;
      if (!apiKey) {
        return reply.status(500).send({ error: "TTS API key not configured" });
      }
      const response = await ky.post("https://api.openai.com/v1/audio/speech", {
        json: {
          model: "gpt-4o-mini-tts-2025-03-20",
          input: text,
          voice: resolvedVoice,
          response_format: "mp3",
          instructions:
            instructions ||
            "Fast and concise, but with a friendly lilting tone.",
        },
        headers: { Authorization: `Bearer ${apiKey}` },
        retry: 2,
        timeout: 30_000,
      });
      reply.header("Content-Type", "audio/mpeg");
      return reply.send(response.body);
    }
  );

  // GET /api/chat/transcribe-ws - WebSocket proxy to Mistral Voxtral Realtime
  server.get(
    "/api/chat/transcribe-ws",
    { websocket: true },
    (socket) => {
      const apiKey = process.env.CALLBACK_MISTRAL_API_KEY;
      if (!apiKey) {
        console.error("[transcribe-ws] CALLBACK_MISTRAL_API_KEY not set");
        socket.send(JSON.stringify({ type: "error", error: "Mistral API key not configured" }));
        socket.close(1008, "API key not configured");
        return;
      }

      const mistralModel = "voxtral-mini-transcribe-realtime-2602";
      const mistralUrl = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(mistralModel)}`;
      const queued: string[] = [];
      let mistralReady = false;

      console.log(`[transcribe-ws] Session started (key: ${apiKey.slice(0, 8)}..., model: ${mistralModel})`);

      const mistral = new WsWebSocket(mistralUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      mistral.on("open", () => {
        // Mistral sends session.created automatically; no session.update needed.
        // Mark ready immediately — queued audio will be flushed.
        mistralReady = true;
        for (const msg of queued) {
          mistral.send(msg);
        }
        queued.length = 0;
      });

      mistral.on("message", (data) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(data.toString());
        }
      });

      mistral.on("error", (err) => {
        console.error(`[transcribe-ws] Mistral error: ${err.message}`);
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "error", error: `Transcription failed: ${err.message}` }));
          socket.close(1011, "Mistral error");
        }
      });

      mistral.on("close", (code, reason) => {
        const reasonStr = reason.toString() || "(no reason)";
        console.log(`[transcribe-ws] Mistral closed: code=${code} reason=${reasonStr}`);
        if (socket.readyState === socket.OPEN) {
          // Send error to client so it knows transcription failed
          socket.send(JSON.stringify({ type: "error", error: `Transcription connection closed (code ${code})` }));
          socket.close(1000, "Mistral closed");
        }
      });

      // Browser → Mistral
      socket.on("message", (data) => {
        const text = data.toString();
        if (mistralReady && mistral.readyState === WsWebSocket.OPEN) {
          mistral.send(text);
        } else {
          queued.push(text);
        }
      });

      socket.on("close", () => {
        console.log("[transcribe-ws] Browser disconnected");
        if (mistral.readyState === WsWebSocket.OPEN || mistral.readyState === WsWebSocket.CONNECTING) {
          mistral.close();
        }
      });

      socket.on("error", (err) => {
        console.error("[transcribe-ws] Browser socket error:", err.message);
        if (mistral.readyState === WsWebSocket.OPEN) {
          mistral.close();
        }
      });
    }
  );
}
