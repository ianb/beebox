/**
 * The registry's reservation-facing half: accepting a coined chat id, warming
 * a subprocess for it, and answering whether the box can address it at all.
 *
 * Split from `registry.ts` for that file's line budget. See `reserve.ts` for
 * what a reservation is and why it is a record rather than a registry entry.
 */

import { makeLog } from "./log.js";
import { reserveChatSession, type ChatReservationStore, type ReserveResult } from "./reserve.js";
import { prewarmReservedChat } from "./registry-warm.js";
import type { ChatBackend } from "../../../services/claude-chat.js";
import type { ChatSessionOptions } from "./options.js";
import type { AgentEngine } from "../../box/config.js";

const log = makeLog("ChatSessionRegistry");

/**
 * Expire reservations past their TTL and release what was held for each — a
 * warm subprocess warmed for a chat nobody is going to start would otherwise
 * hold one of the very few slots until the whole box went idle.
 */
export function sweepExpiredReservations(opts: { store: ChatReservationStore; backend: ChatBackend }): void {
  for (const expired of opts.store.sweepExpired()) opts.backend.closeWarmFor?.(expired);
}

export async function reserveAndWarm(opts: {
  boxRoot: string;
  store: ChatReservationStore;
  backend: ChatBackend;
  baseOptions: ChatSessionOptions;
  sessionId: string;
  contextDir: string | null;
  seedFeatures: Record<string, string>;
  requestedEngine?: AgentEngine | undefined;
  model?: string | undefined;
}): Promise<ReserveResult> {
  const { boxRoot, store, backend, baseOptions, ...request } = opts;
  const result = await reserveChatSession({ boxRoot, store, ...request });
  if (result.kind !== "reserved") return result;
  log("reserve", `Reserved ${result.sessionId} (held=${store.size()})`);
  prewarmReservedChat({
    boxRoot,
    backend,
    baseOptions,
    sessionId: result.sessionId,
    contextDir: request.contextDir,
    ...(request.model !== undefined ? { model: request.model } : {}),
  });
  return result;
}
