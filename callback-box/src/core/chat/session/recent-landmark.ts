import { loadLandmarkSummaries } from "../../landmark/summaries.js";
import { loadAllSessions } from "./list.js";

export const CHAT_FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecentLandmarkChat {
  sessionId: string;
  label: string;
  lastActivity: string;
  landmark: {
    dir: string;
    label: string;
    symbol: string | null;
  };
}

/** Most recently active resumable chats whose bound directory still has a landmark. */
export async function listRecentLandmarkChats(
  boxRoot: string,
  options?: { limit?: number; now?: number },
): Promise<RecentLandmarkChat[]> {
  const limit = options?.limit ?? 2;
  const now = options?.now ?? Date.now();
  const [{ summaries }, sessions] = await Promise.all([
    loadLandmarkSummaries(boxRoot),
    loadAllSessions(boxRoot),
  ]);
  const landmarks = new Map(summaries.map((landmark) => [landmark.dir, landmark]));
  const cutoff = now - CHAT_FRESH_WINDOW_MS;
  const includedLandmarks = new Set<string>();
  const result: RecentLandmarkChat[] = [];
  for (const session of sessions) {
    if (session.mtime.getTime() < cutoff) continue;
    const landmark = landmarks.get(session.contextDir ?? "");
    if (landmark === undefined || includedLandmarks.has(landmark.dir)) continue;
    includedLandmarks.add(landmark.dir);
    result.push({
        sessionId: session.sessionId,
        label: session.label,
        lastActivity: session.mtime.toISOString(),
        landmark: {
          dir: landmark.dir,
          label: landmark.label,
          symbol: landmark.symbol === "" ? null : landmark.symbol,
        },
    });
    if (result.length === limit) break;
  }
  return result;
}

export async function isResumableSession(boxRoot: string, sessionId: string): Promise<boolean> {
  return (await loadAllSessions(boxRoot)).some((session) => session.sessionId === sessionId);
}
