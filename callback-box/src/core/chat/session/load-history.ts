/**
 * loadSessionHistory — read a chat session's conversation log off disk and
 * return a tail-trimmed window of entries.
 *
 * Extracted from `ChatSession.getHistory` so the class body stays under the
 * line limit. Holds no reference to the class — it takes the box root,
 * session id, and tail params explicitly and returns the same shape the
 * method always returned, so `chat-session.ts` just delegates to it.
 */

import * as fs from "node:fs";
import { resolveSessionLogPath } from "./history.js";
import { effectiveTailSize } from "./messages.js";
import { parseSessionLog, type SessionEntry } from "../../../cli/lib/session.js";

export interface SessionHistoryResult {
  sessionId: string | null;
  entries: SessionEntry[];
  total: number;
}

/**
 * Load conversation history from the session log for `sessionId`.
 * Returns an empty result when there is no session id or no log on disk.
 */
export async function loadSessionHistory(
  boxRoot: string,
  opts: {
    sessionId: string | null;
    params?: { tail?: number; minRealUserMessages?: number } | undefined;
  },
): Promise<SessionHistoryResult> {
  const { sessionId, params } = opts;
  if (!sessionId) {
    return { sessionId: null, entries: [], total: 0 };
  }

  const logPath = await resolveSessionLogPath(boxRoot, sessionId);
  if (!fs.existsSync(logPath)) {
    return { sessionId, entries: [], total: 0 };
  }

  const result = await parseSessionLog({ logPath });
  const { entries, total } = result;
  const effectiveTail = effectiveTailSize(entries, params);
  if (effectiveTail !== null && effectiveTail < entries.length) {
    return {
      sessionId,
      entries: entries.slice(entries.length - effectiveTail),
      total,
    };
  }
  return {
    sessionId,
    entries,
    total,
  };
}
