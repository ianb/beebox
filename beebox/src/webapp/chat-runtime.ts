/**
 * Per-box chat runtime accessor.
 *
 * The live `ChatSessionRegistry` + `ChatScheduleManager` are created once per
 * box in `registerChatRoutes` (they hold in-memory `ChatSession` subprocesses,
 * so they can't be rebuilt per request). The raw chat routes reach them through
 * a closure; the chat **tRPC** procedures reach them through this boxRoot-keyed
 * registry instead, so session controls (status/set-model/interrupt/…) can live
 * in tRPC rather than raw Fastify. `registerChatRoutes` sets the runtime on
 * setup and clears it on server close.
 */

import type { ChatSession } from "../core/chat/session/index.js";
import type { ChatSessionRegistry } from "../core/chat/session/registry.js";
import type { ChatScheduleManager } from "../core/chat/schedules.js";

export interface ChatRuntime {
  registry: ChatSessionRegistry;
  scheduleManager: ChatScheduleManager;
  /** Wire a session's events onto the shared event bus (idempotent). */
  wireSession: (session: ChatSession) => void;
  /** Startup backfill followed by husk reconciliation. */
  maintenance: Promise<void>;
}

const runtimes = new Map<string, ChatRuntime>();

export function setChatRuntime(boxRoot: string, runtime: ChatRuntime): void {
  runtimes.set(boxRoot, runtime);
}

export function clearChatRuntime(boxRoot: string): void {
  runtimes.delete(boxRoot);
}

/** The box's chat runtime, or undefined if its chat routes aren't registered. */
export function getChatRuntime(boxRoot: string): ChatRuntime | undefined {
  return runtimes.get(boxRoot);
}

/** Process-wide safe boundary for a bundle-backed server replacement. */
export function chatRuntimesAreIdle(): boolean {
  for (const runtime of runtimes.values()) {
    if (runtime.registry.snapshotAll().some((session) => session.busy)) return false;
  }
  return true;
}
