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
