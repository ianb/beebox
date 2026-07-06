/**
 * Shared context threaded through the chat route-registration modules.
 *
 * `chat.ts` builds one `ChatRoutesContext` (registry, schedule manager,
 * wire-session closure, dedup map, etc.) and hands it to each
 * `registerChat*Routes` sibling. Keeping the shape here — a leaf module that
 * imports no sibling — avoids a value-import cycle back onto `chat.ts`.
 */

import type { FastifyInstance } from "fastify";
import type { ChatSession } from "../../core/chat/session/index.js";
import type { ChatSessionRegistry } from "../../core/chat/session/registry.js";
import type { ChatScheduleManager } from "../../core/chat/schedules.js";
import type { EventBus } from "../../core/event-bus.js";
import type { OpenAIAudioService } from "../../services/openai-audio.js";

export interface ChatRoutesContext {
  server: FastifyInstance;
  boxRoot: string;
  eventBus: EventBus;
  openaiAudio: OpenAIAudioService | undefined;
  registry: ChatSessionRegistry;
  scheduleManager: ChatScheduleManager;
  /** Wire a session's events onto the shared event bus (idempotent). */
  wireSession: (session: ChatSession) => void;
  /**
   * Recently processed message IDs (messageId -> timestamp), used by /send to
   * deduplicate retries. Shared so the dedup window spans the module split.
   */
  processedMessageIds: Map<string, number>;
}
