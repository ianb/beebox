/** Engine selection for fresh and engine-pinned resumed chats. */

import { loadAgentEngine } from "../../box/config.js";
import { reservedEngineFor } from "./reserve.js";
import type { AgentEngine } from "../../../shared/agent-models.js";
import { loadHistoryEntries } from "./history.js";
import { findChatHuskEntry, type ChatHuskEntry } from "../husk-read.js";

/**
 * Which engine a chat runs on. The one resolver — every consumer goes through
 * it rather than re-deriving the order.
 *
 * The order is durability-first: the husk's own `engine` stamp travels with the
 * card to every checkout, while the history entry is per-checkout state. A
 * husk stamped `codex` and pulled onto a machine that never ran the session has
 * no history entry at all, and reading it as Claude sends the resume down the
 * wrong SDK. The box default answers only for a session nothing has recorded.
 *
 * `husk`/`historyEngine` are for callers that already hold the answer: `null`
 * means "looked up, absent", an omitted key means "look it up here".
 */
export async function resolveChatEngine(
  boxRoot: string,
  args: {
    sessionId: string | null;
    husk?: ChatHuskEntry | null;
    historyEngine?: AgentEngine | null;
  },
): Promise<AgentEngine> {
  const { sessionId } = args;
  if (sessionId === null) return loadAgentEngine(boxRoot);
  const husk = args.husk === undefined ? await findChatHuskEntry(boxRoot, sessionId) : args.husk;
  if (husk?.engine !== undefined) return husk.engine;
  const historyEngine = args.historyEngine === undefined
    ? (await loadHistoryEntries(boxRoot)).find((candidate) => candidate.id === sessionId)?.engine ?? null
    : args.historyEngine;
  // A coined-but-unstarted chat's engine lives in its reservation, not yet in
  // history. Only callers holding that reservation can supply the answer.
  return historyEngine ?? reservedEngineFor(sessionId) ?? await loadAgentEngine(boxRoot);
}

/**
 * The engine a chat starts on, honoring a choice made before it existed.
 *
 * A recorded engine always wins: a chat's engine is fixed when it starts.
 * But an id alone is not a record — a COINED session carries its id from the
 * first request, before any husk or history entry exists, and treating the id
 * as a record dropped the picker's `requested` on the floor: the coined start
 * fell through to the box default and tripped the coined-must-be-Claude
 * invariant on a codex box (2026-08-27, ?engine=claude on a codex-default
 * box → 500). Order: recorded (husk, then history) > requested > box default.
 */
export async function resolveStartEngine(
  boxRoot: string,
  { sessionId, requested }: { sessionId: string | null; requested: AgentEngine | null },
): Promise<AgentEngine> {
  if (sessionId === null) return requested ?? loadAgentEngine(boxRoot);
  const husk = await findChatHuskEntry(boxRoot, sessionId);
  if (husk?.engine !== undefined) return husk.engine;
  const recorded = (await loadHistoryEntries(boxRoot)).find((candidate) => candidate.id === sessionId)?.engine ?? null;
  return recorded ?? reservedEngineFor(sessionId) ?? requested ?? await loadAgentEngine(boxRoot);
}
