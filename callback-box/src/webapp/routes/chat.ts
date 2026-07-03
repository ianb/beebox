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
 * timers into the most-active session.
 */

import type { FastifyInstance } from "fastify";
import { type ChatSession, type TaskEvent } from "../../core/chat-session.js";
import { ChatSessionRegistry } from "../../core/chat-session-registry.js";
import {
  getMostActive,
  runBackfillIfNeeded,
} from "../../core/chat-session-history.js";
import { backfillChatHusks } from "../../core/chat-husk.js";
import type { EventBus } from "../../core/event-bus.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";
import {
  ChatScheduleManager,
  parseScheduleTags,
  parseCancelScheduleTags,
} from "../../core/chat-schedules.js";
import { registerChatUploadRoutes } from "./chat-uploads.js";
import type { ChatRoutesContext } from "./chat-context.js";
import { setChatRuntime, clearChatRuntime } from "../chat-runtime.js";
import { registerChatSendRoutes, loadProcessedMessageIds } from "./chat-send-routes.js";
import { registerChatAudioRoutes } from "./chat-audio-routes.js";
import { registerChatLastAudioRoutes } from "./chat-last-audio-routes.js";

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
}

/**
 * Register chat routes on the Fastify server.
 */
export async function registerChatRoutes(
  options: RegisterChatRoutesOptions
): Promise<void> {
  const { server, boxRoot, eventBus, openaiAudio, prewarmChat } = options;

  // File-upload endpoint for chat attachments (writes to <boxRoot>/tmp/).
  await registerChatUploadRoutes({ server, boxRoot });

  // One-shot backfill of pre-existing chat sessions into the history file.
  // Idempotent — returns early on subsequent boots.
  void runBackfillIfNeeded(boxRoot).catch((e: unknown) => {
    console.error("[chat] backfill failed:", e instanceof Error ? e.message : e);
  });

  // One-shot husk-card backfill for pre-husk sessions (marker-gated; ghosts
  // whose transcript is gone are skipped). See docs/plans/chat-husks.md.
  void backfillChatHusks(boxRoot).catch((e: unknown) => {
    console.error("[chat] husk backfill failed:", e instanceof Error ? e.message : e);
  });

  // Per-box registry of ChatSession instances, keyed by sessionId.
  // Turn on partial-message streaming so the per-turn SSE feed delivers
  // token-level text deltas to the frontend; the chat machine and the
  // speech queue pick them up live.
  const registry = new ChatSessionRegistry(boxRoot, {
    buildSessionOptions: () => ({ includePartialMessages: true }),
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
  setChatRuntime(boxRoot, { registry, scheduleManager, wireSession });

  registerChatSendRoutes(ctx);
  registerChatAudioRoutes(ctx);
  registerChatLastAudioRoutes(ctx);

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
