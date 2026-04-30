/**
 * Chat routes - Per-session conversational interface to a box's Claude agent.
 *
 * Sessions are addressed by id. The route layer routes each request to a
 * `ChatSession` instance via `ChatSessionRegistry`. Bare-`/chat` clients
 * resolve the "most-active" pointer to find a default session id.
 *
 * POST /api/chat/send     - Send a message; streams response via SSE
 * POST /api/chat/self-note - Inject a self-note into a session transcript
 * GET  /api/chat/history   - Load conversation history (any session)
 * GET  /api/chat/sessions  - List web chat sessions (history file + metadata)
 * POST /api/chat/interrupt - Interrupt an in-flight turn
 * POST /api/chat/restart   - Kill the subprocess (preserves session id)
 * POST /api/chat/reset     - Drop a session from the registry
 * GET  /api/chat/status    - Session status (running/busy/model)
 * GET  /api/chat/default   - Resolve the "most-active" session id
 * POST /api/chat/set-model - Change a session's active model
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ky from "ky";
import type { FastifyInstance } from "fastify";
import { type ChatMessage, type ChatImage, type ChatSession } from "../../core/chat-session.js";
import { ChatSessionRegistry } from "../../core/chat-session-registry.js";
import {
  getMostActive,
  loadHistory,
  runBackfillIfNeeded,
} from "../../core/chat-session-history.js";
import { WebSocket as WsWebSocket } from "ws";
import { getMistralApiKey } from "../../core/mistral-key.js";
import type { EventBus } from "../../core/event-bus.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";
import { getSessionUser, type SessionUser } from "../auth.js";
import {
  getSessionLogPath,
  getSessionMetadata,
  parseSessionLog,
  tailForMinUserMessages,
} from "../../cli/lib/session.js";
import {
  ChatScheduleManager,
  parseScheduleTags,
  parseCancelScheduleTags,
} from "../../core/chat-schedules.js";
import { registerChatUploadRoutes } from "./chat-uploads.js";

interface SendBody {
  message: string;
  messageId?: string;
  /** Session id to send into. Use "new" to start a fresh conversation. */
  session: string;
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

  // File-upload endpoint for chat attachments (writes to <boxRoot>/tmp/).
  await registerChatUploadRoutes({ server, boxRoot });

  // One-shot backfill of pre-existing chat sessions into the history file.
  // Idempotent — returns early on subsequent boots.
  void runBackfillIfNeeded(boxRoot).catch((e: unknown) => {
    console.error("[chat] backfill failed:", e instanceof Error ? e.message : e);
  });

  // Per-box registry of ChatSession instances, keyed by sessionId.
  const registry = new ChatSessionRegistry(boxRoot);
  registry.startCleanup();

  // Wire any session in the registry to the global event bus on creation.
  // Each entry's events get tagged with sessionId so the frontend can filter.
  const wired = new WeakSet<ChatSession>();
  function wireSession(session: ChatSession): void {
    if (wired.has(session)) return;
    wired.add(session);

    // Parse schedule tags out of completed turns.
    session.on("turn-text", (text: string) => {
      const newSchedules = parseScheduleTags(text);
      for (const s of newSchedules) {
        scheduleManager.addSchedule(s);
      }
      const cancels = parseCancelScheduleTags(text);
      for (const label of cancels) {
        scheduleManager.cancelByLabel(label);
      }
    });

    // Broadcast turn-end so other tabs / the schedule fallback know.
    session.on("done", () => {
      eventBus.emit("chat-complete", {
        sessionId: session.getSessionId(),
        timestamp: new Date().toISOString(),
      });
    });
  }

  // Schedule manager — fires schedules into the most-active session.
  const scheduleManager = new ChatScheduleManager(boxRoot, {
    async onFire({ schedule }) {
      eventBus.emit("schedule-fired", {
        id: schedule.id,
        label: schedule.label,
        alarm: schedule.alarm,
        announce: schedule.announce,
      });

      const targetId = await getMostActive(boxRoot);
      if (!targetId) {
        console.warn("[schedule] No most-active session, dropping fire");
        return;
      }
      const session = registry.getOrCreate(targetId);
      wireSession(session);

      const firedAt = new Date().toISOString();
      const firedMessage = [
        "<schedule-fired label=\"" + schedule.label + "\" scheduled-at=\"" + schedule.createdAt + "\" fired-at=\"" + firedAt + "\">",
        schedule.content,
        "",
        "A scheduled timer \"" + schedule.label + "\" has fired. Respond if you have something useful to say.",
        "</schedule-fired>",
      ].join("\n");

      const onScheduleDone = () => {
        session.getHistory()
          .then((history) => {
            eventBus.emit("chat-history", {
              sessionId: history.sessionId,
              entries: history.entries,
            });
          })
          .catch((_e) => {});
      };
      session.once("done", onScheduleDone);

      registry.enforceLiveCap(targetId);
      registry.touch(targetId, { subprocessUse: true });
      const sent = await session.send(firedMessage);
      if (!sent) {
        session.removeListener("done", onScheduleDone);
      }
    },
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

  /**
   * Resolve the request's `session` param to a `ChatSession`. Handles the
   * "new" sentinel by constructing a pending session and arranging for
   * promotion when its real id arrives.
   *
   * Returns the session and its current id (`null` for a still-pending new
   * session).
   */
  function resolveSendTarget(sessionParam: string): { session: ChatSession; id: string | null } {
    if (sessionParam === "new") {
      const session = registry.createNew();
      wireSession(session);
      return { session, id: null };
    }
    const session = registry.getOrCreate(sessionParam);
    wireSession(session);
    return { session, id: sessionParam };
  }

  // POST /api/chat/send - Send a message and stream the response
  server.post<{ Body: SendBody }>(
    "/api/chat/send",
    async (request, reply) => {
      const body = request.body ?? ({} as Partial<SendBody>);
      const { message, messageId, images, session: sessionParam } = body;

      if (!message) {
        return reply.status(400).send({ error: "message is required" });
      }
      if (!sessionParam) {
        return reply.status(400).send({ error: "session is required (id or 'new')" });
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

      const { session: chatSession, id: knownId } = resolveSendTarget(sessionParam);

      // Identify the sender from the session (may be null if auth is disabled)
      const user = getSessionUser(request);

      // Slash commands (e.g. /compact) are parsed by the claude CLI when they
      // appear at the very start of the user text — any prefix/suffix would
      // break detection, so skip user-attr and pending-schedules injection.
      const isSlashCommand = message.startsWith("/");
      const attributed = user && !isSlashCommand ? injectUserAttr(message, user) : message;

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

      // Broadcast the user message to other clients via SSE.
      // For pending-new sessions, sessionId is still unknown; subscribers will
      // see it once `session-assigned` fires.
      eventBus.emit("chat-user-message", {
        sessionId: knownId,
        message: attributed,
        user: user ? { email: user.email, name: user.name } : null,
        timestamp: new Date().toISOString(),
      });

      // Hijack the response so we control the socket directly and can hold
      // it open across the SSE stream lifetime.
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      // If busy, queue and return — the queue drains on the next "done".
      if (chatSession.isBusy()) {
        chatSession.enqueue({ text: attributed, ...(images ? { images } : {}) });
        reply.raw.write(`data: ${JSON.stringify({ type: "queued" })}\n\n`);
        reply.raw.end();
        return;
      }

      // Append active schedule info so the agent knows what's pending.
      // Skip for slash commands so they remain at the start of the text.
      const pendingInfo = isSlashCommand ? "" : scheduleManager.formatPendingForPrompt();
      const fullMessage = pendingInfo
        ? attributed + "\n<pending-schedules>" + pendingInfo + "</pending-schedules>"
        : attributed;

      // Touch and pin the entry while the SSE stream is open so it survives
      // the idle sweep. (Pending-new sessions aren't yet in `entries`; they
      // pin on promotion via session-assigned.) Also mark this session as
      // the most-active so bare /chat resolves here next time.
      let releasePin: () => void = () => {};
      if (knownId !== null) {
        registry.touch(knownId, { subprocessUse: true });
        registry.enforceLiveCap(knownId);
        releasePin = registry.pin(knownId);
        void registry.markMostActive(knownId).catch((_e) => {});
      }

      const sent = await chatSession.send({
        text: fullMessage,
        ...(images ? { images } : {}),
      });
      if (!sent) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: "error", error: "Failed to send message" })}\n\n`
        );
        reply.raw.end();
        releasePin();
        return;
      }

      // Stream subprocess messages until the turn completes.
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
          releasePin();
          resolve();
        };

        const onDone = () => finish();

        const onError = (err: Error) => {
          try {
            reply.raw.write(
              `data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`
            );
          } catch {
            // Client disconnected
          }
          finish();
        };

        const onClose = () => finish();

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
          releasePin();
          resolve();
        });
      });
    }
  );

  // POST /api/chat/self-note — inject a self-note into a session transcript.
  server.post<{ Body: SelfNoteBody }>(
    "/api/chat/self-note",
    async (request, reply) => {
      const { body, ref, commit, session: requestedSession } = request.body ?? ({} as Partial<SelfNoteBody>);

      if (!body || !body.trim()) {
        return reply.status(400).send({ error: "body is required" });
      }

      // Resolve target session: explicit > most-active.
      const targetId = requestedSession ?? (await getMostActive(boxRoot));
      if (!targetId) {
        return reply.status(404).send({ error: "no live chat session" });
      }
      const target = registry.get(targetId);
      if (!target) {
        return reply.status(404).send({
          error: requestedSession
            ? `session "${requestedSession}" is not live`
            : "no live chat session",
        });
      }

      const attrs: string[] = [];
      if (ref) attrs.push(`ref="${escapeXmlAttr(ref)}"`);
      if (commit) attrs.push(`commit="${escapeXmlAttr(commit)}"`);
      const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
      const wrapped = `<self-note${attrStr}>\n${body.trim()}\n</self-note>`;

      if (target.isBusy()) {
        target.enqueue({ text: wrapped });
      } else {
        registry.enforceLiveCap(targetId);
        registry.touch(targetId, { subprocessUse: true });
        target.send({ text: wrapped }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[self-note] send failed:", msg);
        });
      }

      return reply.send({ ok: true, sessionId: target.getSessionId() });
    }
  );

  // GET /api/chat/history?session=<id> — load conversation history.
  // `session` is required.
  server.get<{ Querystring: { session?: string; tail?: string; offset?: string; limit?: string; minRealUserMessages?: string } }>("/api/chat/history", async (request, reply) => {
    const sessionId = request.query.session;
    if (!sessionId) {
      return reply.status(400).send({ error: "session is required" });
    }
    const tail = request.query.tail ? parseInt(request.query.tail, 10) : undefined;
    const offset = request.query.offset ? parseInt(request.query.offset, 10) : undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    const minRealUserMessages = request.query.minRealUserMessages
      ? parseInt(request.query.minRealUserMessages, 10)
      : undefined;
    const logPath = getSessionLogPath(boxRoot, sessionId);
    try {
      const result = await parseSessionLog({ logPath, ...(offset != null ? { offset } : {}), ...(limit != null ? { limit } : {}) });
      const { entries, total } = result;
      const userTail = minRealUserMessages && minRealUserMessages > 0
        ? tailForMinUserMessages(entries, minRealUserMessages)
        : 0;
      const effective = tail && tail > 0 ? Math.max(tail, userTail) : (userTail > 0 ? userTail : undefined);
      if (effective !== undefined && effective < entries.length) {
        return { sessionId, entries: entries.slice(entries.length - effective), total };
      }
      return { sessionId, entries, total };
    } catch (_e) {
      return { sessionId, entries: [], total: 0 };
    }
  });

  // GET /api/chat/sessions — list web chat sessions only, with first-user-snippet labels.
  server.get("/api/chat/sessions", async () => {
    const ids = await loadHistory(boxRoot);
    const mostActive = await getMostActive(boxRoot);

    const sessions = await Promise.all(
      ids.map(async (sessionId) => {
        const logPath = getSessionLogPath(boxRoot, sessionId);
        let label = sessionId.slice(0, 8);
        let lastUsedAt = new Date(0).toISOString();
        try {
          const stat = await fs.stat(logPath);
          lastUsedAt = stat.mtime.toISOString();
          const meta = await getSessionMetadata({ sessionId, logPath });
          if (meta.firstUserSnippet) label = meta.firstUserSnippet;
          if (meta.endTime) lastUsedAt = meta.endTime.toISOString();
        } catch {
          // JSONL missing or unreadable — keep id-prefix label.
        }
        return {
          sessionId,
          source: "chat",
          label,
          lastUsedAt,
          isActive: sessionId === mostActive,
        };
      })
    );

    sessions.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
    return { sessions };
  });

  // POST /api/chat/interrupt — interrupt the in-flight turn for a session.
  server.post<{ Body: { session?: string } }>("/api/chat/interrupt", async (request, reply) => {
    const sessionId = request.body?.session;
    if (!sessionId) return reply.status(400).send({ error: "session is required" });
    const target = registry.get(sessionId);
    if (!target) return reply.status(404).send({ error: "session not live" });
    target.interrupt();
    return { ok: true };
  });

  // POST /api/chat/restart — kill subprocess, preserving session id and queue.
  server.post<{ Body: { session?: string } }>("/api/chat/restart", async (request, reply) => {
    const sessionId = request.body?.session;
    if (!sessionId) return reply.status(400).send({ error: "session is required" });
    const target = registry.get(sessionId);
    if (!target) return reply.status(404).send({ error: "session not live" });
    target.restart();
    return { ok: true };
  });

  // GET /api/chat/status?session=<id> — session status (running, busy, model).
  // Without `session`, returns empty/default — bare /chat resolves via /default.
  server.get<{ Querystring: { session?: string } }>("/api/chat/status", async (request) => {
    const sessionId = request.query.session;
    if (!sessionId) {
      return { sessionId: null, running: false, busy: false, model: null };
    }
    const target = registry.get(sessionId);
    if (!target) {
      return { sessionId, running: false, busy: false, model: null };
    }
    return {
      sessionId: target.getSessionId(),
      running: target.isRunning(),
      busy: target.isBusy(),
      model: target.getCurrentModel(),
    };
  });

  // GET /api/chat/default — return the most-active session id (for bare /chat).
  server.get("/api/chat/default", async () => {
    const sessionId = await getMostActive(boxRoot);
    return { sessionId };
  });

  // POST /api/chat/set-model — change a session's active model.
  // Uses getOrCreate so an evicted session is re-registered rather than 404'd
  // (the model is persisted to chat-model.json regardless). After saving,
  // restart the live subprocess so the next turn actually picks up the new
  // model — the `set_model` control_request to a live subprocess isn't
  // honored by Claude Code, so without a restart the live proc stays pinned
  // to the `--model` it was spawned with.
  server.post<{ Body: { model: string | null; session?: string } }>(
    "/api/chat/set-model",
    async (request, reply) => {
      const { model, session: sessionId } = request.body;
      if (!sessionId) return reply.status(400).send({ error: "session is required" });
      const target = registry.getOrCreate(sessionId);
      wireSession(target);
      target.setModel(model);
      let restarted = false;
      if (target.isRunning()) {
        if (target.isBusy()) {
          // Mid-turn — defer restart until the current turn ends, otherwise
          // the in-progress response is lost. The close handler drains any
          // queued sends into the fresh subprocess.
          target.once("done", () => {
            if (target.isRunning()) target.restart();
          });
        } else {
          target.restart();
          restarted = true;
        }
      }
      return { ok: true, model: target.getCurrentModel(), restarted };
    }
  );

  // GET /api/chat/schedules — list active schedules (single per-box manager).
  server.get("/api/chat/schedules", async () => {
    return { schedules: scheduleManager.getActive() };
  });

  // POST /api/chat/schedules/cancel — cancel a schedule by label.
  server.post<{ Body: { label: string } }>(
    "/api/chat/schedules/cancel",
    async (request) => {
      const { label } = request.body;
      const cancelled = scheduleManager.cancelByLabel(label);
      return { ok: cancelled };
    }
  );

  // GET /api/chat/voice-config - Return speaking voice config from personality
  server.get("/api/chat/voice-config", async (_request, _reply) => {
    try {
      const voicePath = path.join(boxRoot, "docs/generated/speaking-voice.json");
      const content = await fs.readFile(voicePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return { model: undefined, instructions: [] };
    }
  });

  // Surface session-id assignments as SSE events so a tab waiting on a
  // pending "new" send can pick up the real id and update its URL.
  registry.on("session-assigned", ({ sessionId }: { sessionId: string }) => {
    eventBus.emit("chat-session-assigned", { sessionId });
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
        const ttsOpts: { voice?: string; instructions?: string } = { voice: resolvedVoice };
        if (instructions) ttsOpts.instructions = instructions;
        const result = await openaiAudio.textToSpeech(text, ttsOpts);
        reply.header("Content-Type", result.contentType);
        return reply.send(result.audio);
      }

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
          socket.send(JSON.stringify({ type: "error", error: `Transcription connection closed (code ${code})` }));
          socket.close(1000, "Mistral closed");
        }
      });

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

  // Tear down the registry on server close so subprocesses don't linger.
  server.addHook("onClose", async () => {
    registry.shutdown();
  });
}
