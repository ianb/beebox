/** Engine selection for fresh and engine-pinned resumed chats. */

import { loadAgentEngine, type AgentEngine } from "../../box/config.js";
import { loadHistoryEntries } from "./history.js";

export async function resolveChatEngine(
  boxRoot: string,
  sessionId: string | null,
): Promise<AgentEngine> {
  if (sessionId === null) return loadAgentEngine(boxRoot);
  const entry = (await loadHistoryEntries(boxRoot)).find((candidate) => candidate.id === sessionId);
  return entry?.engine ?? "claude";
}

/**
 * The engine a chat starts on, honoring a choice made before it existed.
 *
 * A recorded engine always wins: a chat's engine is fixed when it starts, so
 * `requested` can only ever answer for a chat that has no id yet. Keeping that
 * rule inside one function is what stops a picker from appearing to offer a
 * switch that the read path would then ignore.
 */
export async function resolveStartEngine(
  boxRoot: string,
  { sessionId, requested }: { sessionId: string | null; requested: AgentEngine | null },
): Promise<AgentEngine> {
  if (sessionId !== null) return resolveChatEngine(boxRoot, sessionId);
  return requested ?? loadAgentEngine(boxRoot);
}
