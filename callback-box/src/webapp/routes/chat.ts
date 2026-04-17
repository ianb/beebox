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
import { ChatSession, type ChatMessage, type ChatImage } from "../../core/chat-session.js";
import { WebSocket as WsWebSocket } from "ws";
import { getMistralApiKey } from "../../core/mistral-key.js";
import type { EventBus } from "../../core/event-bus.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";
import { getSessionUser, type SessionUser } from "../auth.js";
import {
  listSessions,
  getSessionLogPath,
  parseSessionLog,
} from "../../cli/lib/session.js";
import {
  ChatScheduleManager,
  parseScheduleTags,
  parseCancelScheduleTags,
} from "../../core/chat-schedules.js";

interface SendBody {
  message: string;
  messageId?: string;
  /**
   * Optional image attachments referenced by `[imageN]` tokens in `message`.
   * Tokens are replaced with the image block in the content array sent to
   * Claude; unreferenced images are appended at the end.
   */
  images?: ChatImage[];
}

interface SelfNoteBody {
  body: string;
  ref?: string;
  commit?: string;
  session?: string;
}

function escapeXmlAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Soft cap on total base64 image payload per request (25 MB). */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

interface RegisterChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
  openaiAudio?: OpenAIAudioService | undefined;
}

/**
 * Register chat routes on the Fastify server.
 */
export async function registerChatRoutes(
  options: RegisterChatRoutesOptions
): Promise<void> {
  const { server, boxRoot, eventBus, openaiAudio } = options;
  // Create singleton ChatSession for this box
  const chatSession = new ChatSession(boxRoot);

  // Schedule manager — fires schedules back into the chat session
  const scheduleManager = new ChatScheduleManager(boxRoot, {
    async onFire({ schedule }) {
      // Broadcast a schedule-fired event so the frontend can play alarms/TTS
      eventBus.emit("schedule-fired", {
        id: schedule.id,
        label: schedule.label,
        alarm: schedule.alarm,
        announce: schedule.announce,
      });

      // Inject a message into the chat session to wake the agent
      const firedAt = new Date().toISOString();
      const firedMessage = [
        "<schedule-fired label=\"" + schedule.label + "\" scheduled-at=\"" + schedule.createdAt + "\" fired-at=\"" + firedAt + "\">",
        schedule.content,
        "",
        "A scheduled timer \"" + schedule.label + "\" has fired. Respond if you have something useful to say.",
        "</schedule-fired>",
      ].join("\n");

      // Listen for the agent's response to complete, then push the
      // full history to the frontend via SSE so it can display the reply.
      const onScheduleDone = () => {
        chatSession.getHistory()
          .then((history) => {
            eventBus.emit("chat-history", {
              entries: history.entries,
              sessionId: history.sessionId,
            });
          })
          .catch((_e) => {});
      };
      chatSession.once("done", onScheduleDone);

      const sent = await chatSession.send(firedMessage);
      if (!sent) {
        chatSession.removeListener("done", onScheduleDone);
      }
    },
  });


  // Listen for completed turns to parse schedule/cancel tags
  chatSession.on("turn-text", (text: string) => {
    // Process <schedule> tags
    const newSchedules = parseScheduleTags(text);
    for (const s of newSchedules) {
      scheduleManager.addSchedule(s);
    }

    // Process <cancel-schedule> tags
    const cancels = parseCancelScheduleTags(text);
    for (const label of cancels) {
      scheduleManager.cancelByLabel(label);
    }
  });

  /**
   * Inject user="Name" into the opening <typed> or <speech> tag of a message.
   */
  function injectUserAttr(message: string, user: SessionUser): string {
    return message.replace(
      /^(<(?:typed|speech)\b)([^>]*>)/,
      `$1 user="${user.name.replace(/"/g, "&quot;")}" user-email="${user.email.replace(/"/g, "&quot;")}"$2`
    );
  }

  // Track recently processed message IDs to prevent duplicate sends on retry.
  // Map of messageId → timestamp. Pruned periodically.
  const processedMessageIds = new Map<string, number>();
  const MESSAGE_ID_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function pruneMessageIds(): void {
    const cutoff = Date.now() - MESSAGE_ID_TTL_MS;
    for (const [id, ts] of processedMessageIds) {
      if (ts < cutoff) processedMessageIds.delete(id);
    }
  }

  // POST /api/chat/send - Send a message and stream the response
  server.post<{ Body: SendBody }>(
    "/api/chat/send",
    async (request, reply) => {
      const body = request.body ?? {};
      const { message, messageId, images } = body;

      if (!message) {
        return reply.status(400).send({ error: "message is required" });
      }

      // Validate image attachments
      if (images && images.length > 0) {
        let totalBytes = 0;
        for (const img of images) {
          if (typeof img.id !== "number" || !img.mimeType || !img.dataBase64) {
            return reply.status(400).send({ error: "invalid image attachment (id, mimeType, dataBase64 required)" });
          }
          if (!img.mimeType.startsWith("image/")) {
            return reply.status(400).send({ error: `unsupported mime type: ${img.mimeType}` });
          }
          totalBytes += img.dataBase64.length;
          if (totalBytes > MAX_IMAGE_BYTES) {
            return reply.status(413).send({ error: "image attachments exceed 25 MB total" });
          }
        }
      }

      // Deduplicate retries: if we've already processed this messageId,
      // return success without re-sending to the agent
      if (messageId) {
        pruneMessageIds();
        if (processedMessageIds.has(messageId)) {
          console.log(`[chat] Duplicate message ${messageId}, skipping`);
          reply.hijack();
          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          reply.raw.write(`data: ${JSON.stringify({ type: "result", deduplicated: true })}\n\n`);
          reply.raw.end();
          return;
        }
        processedMessageIds.set(messageId, Date.now());
      }

      // Identify the sender from the session (may be null if auth is disabled)
      const user = getSessionUser(request);

      // Inject user attribution into the message
      const attributed = user ? injectUserAttr(message, user) : message;

      // Broadcast the user message to other clients via SSE
      eventBus.emit("chat-user-message", {
        message: attributed,
        user: user ? { email: user.email, name: user.name } : null,
        timestamp: new Date().toISOString(),
      });

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

      // If busy, queue the message for later delivery
      if (chatSession.isBusy()) {
        chatSession.enqueue({ text: attributed, ...(images ? { images } : {}) });
        reply.raw.write(
          `data: ${JSON.stringify({ type: "queued" })}\n\n`
        );
        reply.raw.end();
        return;
      }

      // Append active schedule info so the agent knows what's pending
      const pendingInfo = scheduleManager.formatPendingForPrompt();
      const fullMessage = pendingInfo
        ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>"
        : attributed;

      // Send the message (may start the process if not running)
      const sent = await chatSession.send({
        text: fullMessage,
        ...(images ? { images } : {}),
      });
      if (!sent) {
        reply.raw.write(
          `data: ${JSON.stringify({
            type: "error",
            error: "Failed to send message",
          })}\n\n`
        );
        reply.raw.end();
        return;
      }

      // Wait for the turn to complete.
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
          eventBus.emit("chat-complete", {
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
      });
    }
  );

  // POST /api/chat/self-note - Post a self-note (agent-authored record) to
  // the live chat session. Enqueues a user-position message wrapped in
  // <self-note> so it lands in the session transcript; Claude sees the tag
  // and knows not to treat it as conversational input.
  server.post<{ Body: SelfNoteBody }>(
    "/api/chat/self-note",
    async (request, reply) => {
      const { body, ref, commit, session } = request.body ?? {};

      if (!body || !body.trim()) {
        return reply.status(400).send({ error: "body is required" });
      }

      if (session) {
        const liveId = chatSession.getSessionId();
        if (liveId !== session) {
          return reply.status(404).send({
            error: liveId
              ? `session "${session}" is not the live chat session (live: "${liveId}")`
              : `session "${session}" not live (no chat session active yet)`,
          });
        }
      }

      const attrs: string[] = [];
      if (ref) attrs.push(`ref="${escapeXmlAttr(ref)}"`);
      if (commit) attrs.push(`commit="${escapeXmlAttr(commit)}"`);
      const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
      const wrapped = `<self-note${attrStr}>\n${body.trim()}\n</self-note>`;

      if (chatSession.isBusy()) {
        chatSession.enqueue({ text: wrapped });
      } else {
        chatSession.send({ text: wrapped }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[self-note] send failed:", msg);
        });
      }

      return reply.send({ ok: true, sessionId: chatSession.getSessionId() });
    }
  );

  // GET /api/chat/history - Load conversation history
  // Optional ?session=<id> to view any session's history (read-only)
  // Optional ?tail=N to load only the last N entries (returns total count)
  // Optional ?offset=N&limit=N for explicit pagination
  server.get<{ Querystring: { session?: string; tail?: string; offset?: string; limit?: string } }>("/api/chat/history", async (request) => {
    const sessionId = request.query.session;
    const tail = request.query.tail ? parseInt(request.query.tail, 10) : undefined;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    if (!sessionId) {
      return chatSession.getHistory(tail ? { tail } : undefined);
    }
    // Load from JSONL file directly
    const logPath = getSessionLogPath(boxRoot, sessionId);
    try {
      const result = await parseSessionLog({ logPath, ...(offset != null ? { offset } : {}), ...(limit != null ? { limit } : {}) });
      const { entries, total } = result;
      if (tail && tail < entries.length) {
        return { sessionId, entries: entries.slice(entries.length - tail), total };
      }
      return { sessionId, entries, total };
    } catch (_e) {
      return { sessionId, entries: [], total: 0 };
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

  // GET /api/chat/schedules - List active schedules
  server.get("/api/chat/schedules", async () => {
    return { schedules: scheduleManager.getActive() };
  });

  // POST /api/chat/schedules/cancel - Cancel a schedule by label
  server.post<{ Body: { label: string } }>(
    "/api/chat/schedules/cancel",
    async (request) => {
      const { label } = request.body;
      const cancelled = scheduleManager.cancelByLabel(label);
      return { ok: cancelled };
    }
  );

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
    async (socket) => {
      const apiKey = await getMistralApiKey(boxRoot);
      if (!apiKey) {
        console.error("[transcribe-ws] Mistral API key not found");
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
