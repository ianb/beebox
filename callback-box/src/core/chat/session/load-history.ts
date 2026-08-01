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
 * A session with no readable log reads as empty rather than failing — an id
 * that hasn't produced a JSONL yet (a brand-new chat, an SDK turn that errored
 * before writing) is a normal state. Any other read failure degrades the same
 * way so the chat page still renders, but never silently.
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
    if (errnoCode(e) !== "ENOENT") {
      console.warn(
        `chat history: could not read the log for session ${sessionId}, showing it as empty:`,
        e,
      );
    }
    return { sessionId, entries: [], total: 0 };
  }
}
