/**
 * Chat routes - Per-session conversational interface to a box's Claude agent.
 *
 * Sessions are addressed by id. The route layer routes each request to a
 * `ChatSession` instance via `ChatSessionRegistry`. Bare-`/chat` clients
 * resolve the "most-active" pointer to find a default session id.
 *
 * The individual handlers live in sibling modules, each handed a shared
 * {@link ChatRoutesContext} (registry, schedule manager, event bus, dedup map):
 *
 * - chat-send-routes.ts    — POST /api/chat/send, /api/chat/self-note
 * - chat-audio-routes.ts   — transcribe-audio, voice-config, tts, transcribe-ws
 *
 * Session controls (history, sessions, status, set-model, set-feature,
 * interrupt, restart, schedules) moved to the chat **tRPC** router; they reach
 * the live registry/schedule manager through `webapp/chat-runtime.ts`, which
 * this module populates.
 *
 * This module owns the wiring that the raw handlers share: registry lifecycle,
 * per-session event bridging to the bus, and the schedule manager that fires
 * timers back into the session that created them (chat-schedule-fire.ts).
 */

import type { FastifyInstance } from "fastify";
import { type ChatSession, type TaskEvent } from "../../core/chat/session/index.js";
import { ChatSessionRegistry } from "../../core/chat/session/registry.js";
import type { ChatBackend } from "../../services/claude-chat-types.js";
import { getMostActive } from "../../core/chat/session/history.js";
import { runBackfillIfNeeded } from "../../core/chat/session/backfill.js";
import { reconcileChatHusks } from "../../core/chat/husk.js";
import type { EventBus } from "../../core/event-bus.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";
import { ChatScheduleManager, parseScheduleTags, parseCancelScheduleTags } from "../../core/chat/schedules.js";
import { fireChatSchedule } from "./chat-schedule-fire.js";
import { registerChatUploadRoutes } from "./chat-uploads.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { setChatRuntime, clearChatRuntime } from "../chat-runtime.js";
import { registerChatSendRoutes, loadProcessedMessageIds } from "./chat-send-routes.js";
import { registerChatAudioRoutes } from "./chat-audio-routes.js";
import { registerChatLastAudioRoutes } from "./chat-last-audio-routes.js";
import { registerChatAudioReviewRoutes } from "./chat-audio-review-routes.js";
import { registerChatScreenshotRoutes } from "./chat-screenshot-routes.js";
import { chatModelFileForSession, DEFAULT_MODEL_FILE } from "../../core/chat/session/state.js";

interface RegisterChatRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
  openaiAudio?: OpenAIAudioService | undefined;
  /**
   * If true, eagerly pre-warm a Claude subprocess so the first "new chat"
   * send doesn't pay spawn + initialize latency. Production servers set
   * this; tests leave it off so spawning a real Claude subprocess doesn't
   * hold the test runner open.
   */
  prewarmChat?: boolean | undefined;
  /** Backend for every session this box creates; production omits it. */
  chatBackend?: ChatBackend | undefined;
}

/**
 * Register chat routes on the Fastify server.
 */
export async function registerChatRoutes(options: RegisterChatRoutesOptions): Promise<void> {
  const { server, boxRoot, eventBus, openaiAudio, prewarmChat, chatBackend } = options;

  // File-upload endpoint for chat attachments (writes to <boxRoot>/tmp/).
  await registerChatUploadRoutes({ server, boxRoot });

  // One-shot backfill of pre-existing chat sessions into the history file,
  // then the husk reconcile that gives each of them a card. Husks are what the
  // picker and the history dropdown enumerate, so the reconcile must run AFTER
  // the history backfill — run concurrently it can read a history the backfill
  // hasn't finished writing and leave those sessions card-less. Both stay off
  // the boot critical path; the reconcile is idempotent and repeats each boot,
  // so a session that misses this pass is picked up by the next one.
  // See docs/plans/chat-husks.md.
  const maintenance = runBackfillIfNeeded(boxRoot).then(() => reconcileChatHusks(boxRoot)).catch((e: unknown) => {
    console.error("[chat] session backfill failed:", e instanceof Error ? e.message : e);
  });
  // Registration starts maintenance in the background, but shutdown still owns
  // its lifetime. Tests and production teardown may remove the box immediately
  // after Fastify closes; wait here so the task cannot write into a disappearing
  // directory after `server.close()` has resolved.
  server.addHook("onClose", () => maintenance);

  // Per-box registry of ChatSession instances, keyed by sessionId.
  // Turn on partial-message streaming so the per-turn SSE feed delivers
  // token-level text deltas to the frontend; the chat machine and the
  // speech queue pick them up live.
  const registry = new ChatSessionRegistry(boxRoot, {
    ...(chatBackend !== undefined ? { backend: chatBackend } : {}),
    buildSessionOptions: (sessionId) => ({
      includePartialMessages: true,
      // A fresh session inherits the legacy default once (field tests use it),
      // then promotes that value into its native session-specific file.
      modelFile: sessionId === null ? DEFAULT_MODEL_FILE : chatModelFileForSession(sessionId),
      modelFileForSession: chatModelFileForSession,
    }),
  });
  registry.startCleanup();
  if (prewarmChat === true) {
    // Pre-warm a Claude subprocess against the default chat options so the
    // first "new chat" send doesn't pay spawn + initialize latency.
    void registry.prewarm().catch((e: unknown) => {
      console.error("[chat] prewarm failed:", e instanceof Error ? e.message : e);
    });
  }

  // Wire any session in the registry to the global event bus on creation.
  // Each entry's events get tagged with sessionId so the frontend can filter.
  const wired = new WeakSet<ChatSession>();
  function wireSession(session: ChatSession): void {
    if (wired.has(session)) return;
    wired.add(session);

    // Parse schedule tags out of completed turns.
    session.on("turn-text", (text: string) => {
      const newSchedules = parseScheduleTags(text);
      // Stamp each schedule with the emitting session's id so its fire lands
      // back in this conversation. The id is assigned by the time a turn
      // completes; if it's somehow still null, omit it (falls back to the
      // most-active session, like a legacy entry).
      const sessionId = session.getSessionId();
      for (const s of newSchedules) {
        scheduleManager.addSchedule(sessionId !== null ? { ...s, sessionId } : s);
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

    // Bridge background-task lifecycle events (started / progress / settled)
    // onto the shared bus, tagged with the session id. Transient because
    // progress is ephemeral — terminal state is recoverable from the
    // settled <task-notification> already persisted in the transcript.
    session.on("task", (task: TaskEvent) => {
      eventBus.emitTransient("chat-task", {
        sessionId: session.getSessionId(),
        task,
      });
    });

    // Bridge per-session feature changes (from setFeature or agent deltas)
    // out to the shared event bus so subscribed clients sync.
    session.on("features-changed", (payload: { features: Record<string, string> }) => {
      const sessionId = session.getSessionId();
      if (sessionId === null) return;
      eventBus.emitTransient("chat-features-changed", {
        sessionId,
        features: payload.features,
      });
    });
  }

  // Schedule manager — fires each schedule back into its originating session
  // (see chat-schedule-fire.ts); legacy entries without a session id fall back
  // to the most-active one.
  const scheduleManager = new ChatScheduleManager(boxRoot, {
    onFire: ({ schedule }) => fireChatSchedule({ boxRoot, registry, eventBus, wireSession }, schedule),
  });

  // Shared context handed to each route module.
  const ctx: ChatRoutesContext = {
    server,
    boxRoot,
    eventBus,
    openaiAudio,
    registry,
    scheduleManager,
    wireSession,
    // Track recently processed message IDs to prevent duplicate sends on retry.
    // Map of messageId → timestamp. Hydrated from disk so a restart between a
    // send and its retry still dedupes; pruned/persisted by /send.
    processedMessageIds: loadProcessedMessageIds(boxRoot),
  };

  // Expose the live registry + schedule manager to the chat tRPC procedures
  // (session controls live in tRPC; see webapp/chat-runtime.ts).
  setChatRuntime(boxRoot, {
    registry,
    scheduleManager,
    wireSession,
    maintenance,
  });

  server.get("/api/chat/default", async () => {
    const sessionId = await getMostActive(boxRoot);
    return { sessionId };
  });

  registerChatSendRoutes(ctx);
  registerChatAudioRoutes(ctx);
  registerChatLastAudioRoutes(ctx);
  registerChatAudioReviewRoutes(ctx);
  registerChatScreenshotRoutes(ctx);

  // Surface session-id assignments as SSE events so a tab waiting on a
  // pending "new" send can pick up the real id and update its URL.
  registry.on("session-assigned", ({ sessionId }: { sessionId: string }) => {
    eventBus.emit("chat-session-assigned", { sessionId });
  });

  // Tear down the registry on server close so subprocesses don't linger.
  server.addHook("onClose", async () => {
    clearChatRuntime(boxRoot);
    registry.shutdown();
  });
}
