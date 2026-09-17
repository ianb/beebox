/** Engine selection for fresh and engine-pinned resumed chats. */

import { loadAgentEngine } from "../../box/config.js";
import { reservedEngineFor } from "./reserve.js";
import type { AgentEngine } from "../../../shared/agent-models.js";
import { loadHistoryEntries } from "./history.js";
import { findChatHuskEntry, type ChatHuskEntry } from "../husk-read.js";

export interface RecordedEngineArgs {
  sessionId: string;
  husk?: ChatHuskEntry | null;
  historyEngine?: AgentEngine | null;
}

/**
 * The engine a session's own records name, or `null` when NOTHING recorded it.
 *
 * The three records, durability-first: the husk's own `engine` stamp travels
 * with the card to every checkout; the history entry is per-checkout state; the
 * reservation covers a coined-but-unstarted chat whose engine is not in history
 * yet (only a caller holding that reservation can supply it). A husk stamped
 * `codex` and pulled onto a machine that never ran the session has no history
 * entry at all, and reading it as Claude sends the resume down the wrong SDK.
 *
 * Split out of `resolveChatEngine` so "no record of this session" is a value a
 * caller can act on rather than a case indistinguishable from "the box default
 * happens to be this". Every read that then asks an ENGINE for the session —
 * "does this transcript exist", "give me its history" — must handle the `null`
 * instead of picking a store to interrogate: an id nothing recorded has no
 * transcript in either engine, so guessing one can only produce that engine's
 * failure. It produced exactly that (2026-09-03): a `git reset --hard` rewound
 * a box's chat registry AND the husk card, the open session became an id with
 * no record, the box default said `codex`, and the Codex history read for a
 * thread that never existed surfaced as an error banner on a live chat.
 *
 * `husk`/`historyEngine` are for callers that already hold the answer: `null`
 * means "looked up, absent", an omitted key means "look it up here".
 */
export async function resolveRecordedChatEngine(
  boxRoot: string,
  args: RecordedEngineArgs,
): Promise<AgentEngine | null> {
  const { sessionId } = args;
  const husk = args.husk === undefined ? await findChatHuskEntry(boxRoot, sessionId) : args.husk;
  if (husk?.engine !== undefined) return husk.engine;
  const historyEngine = args.historyEngine === undefined
    ? (await loadHistoryEntries(boxRoot)).find((candidate) => candidate.id === sessionId)?.engine ?? null
    : args.historyEngine;
  return historyEngine ?? reservedEngineFor(sessionId);
}

/**
 * Which engine a chat runs on. The one resolver — every consumer goes through
 * it rather than re-deriving the order.
 *
 * {@link resolveRecordedChatEngine} first, then the box default. The default is
 * a GUESS, correct for a chat that has not started yet and unfalsifiable for
 * one whose records are gone; a caller that cannot act on a wrong answer should
 * ask `resolveRecordedChatEngine` and handle its `null`.
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
  const recorded = await resolveRecordedChatEngine(boxRoot, { ...args, sessionId });
  return recorded ?? await loadAgentEngine(boxRoot);
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
  const recorded = await resolveRecordedChatEngine(boxRoot, { sessionId });
  return recorded ?? requested ?? await loadAgentEngine(boxRoot);
}
