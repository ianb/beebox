/**
 * `loadSessionHistory` — THE way to read a chat session's conversation log.
 *
 * One loader for every caller (the ChatSession method, the `chat.history` /
 * `chat.bootstrap` procedures, the schedule-fire broadcast). It takes a
 * bounded {@link SessionLogSlice} and pushes it straight into
 * `parseSessionLog`, so no caller can reach an unbounded read by
 * construction — that path is what OOM'd `cb serve` in prod (2026-08-01).
 *
 * Three near-identical variants used to exist (here, `session/state.ts`, and
 * `webapp/trpc/routers/chat-session-procedures.ts`), each parsing the whole
 * file and trimming the fully-materialized array afterwards. They are gone.
 */

import { resolveSessionLogPath } from "./history.js";
import {
  parseSessionLog,
  type SessionEntry,
  type SessionLogSlice,
} from "../../../cli/lib/session.js";
import { errnoCode } from "../../../lib/error-guards.js";

// Re-exported so callers of the loader name their slice from the same module.
export type { SessionLogSlice } from "../../../cli/lib/session.js";

/** How much history the chat UI loads on mount and on every refresh. */
export const CHAT_HISTORY_TAIL = 200;
/** Floor on how many real (typed/spoken) user messages that window covers. */
export const CHAT_HISTORY_MIN_REAL_USER_MESSAGES = 2;

/** The default chat window: the last {@link CHAT_HISTORY_TAIL} entries. */
export function chatHistorySlice(): SessionLogSlice {
  return {
    mode: "tail",
    tail: CHAT_HISTORY_TAIL,
    minRealUserMessages: CHAT_HISTORY_MIN_REAL_USER_MESSAGES,
  };
}

export interface SessionHistoryResult {
  sessionId: string | null;
  entries: SessionEntry[];
  /** Exact count of entries in the whole transcript, not just the window. */
  total: number;
}

/**
 * Load a bounded window of conversation history for `sessionId`.
 *
 * **Only ENOENT reads as empty.** A session id that hasn't produced a JSONL yet
 * (a brand-new chat, an SDK turn that errored before writing) is a normal
 * state, and an empty transcript is the truthful answer for it. Every other
 * read failure THROWS, because "empty" is not a safe degradation here — it is
 * indistinguishable from a real answer, and the callers act on it:
 * `chat-schedule-fire` broadcasts this result to every open tab, so a transient
 * EIO used to visibly wipe a live conversation off the screen. Failing loud
 * instead leaves each caller with the right behaviour: the tRPC procedures
 * (`chat.history`, `chat.bootstrap`) surface an error and the tab keeps the
 * state it has, and the broadcast's `.catch` skips the emit entirely.
 */
export async function loadSessionHistory(
  boxRoot: string,
  opts: { sessionId: string | null; slice: SessionLogSlice },
): Promise<SessionHistoryResult> {
  const { sessionId, slice } = opts;
  if (!sessionId) {
    return { sessionId: null, entries: [], total: 0 };
  }

  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  try {
    const { entries, total } = await parseSessionLog({ logPath, slice });
    return { sessionId, entries, total };
  } catch (e) {
    if (errnoCode(e) === "ENOENT") {
      return { sessionId, entries: [], total: 0 };
    }
    throw e;
  }
}
