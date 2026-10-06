import { loadLandmarkSummaries, type LandmarkSummary } from "../../landmark/summaries.js";
import { loadAllSessions, type ChatSessionRow } from "./list/core.js";

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

/** A chat's landmark as the recent-chat rows show it, or undefined when none resolves for its directory. */
export function chatLandmark(
  landmarks: ReadonlyMap<string, LandmarkSummary>,
  session: ChatSessionRow,
): RecentLandmarkChat["landmark"] | undefined {
  const landmark = landmarks.get(session.contextDir ?? "");
  return landmark === undefined ? undefined : { dir: landmark.dir, label: landmark.label, symbol: landmark.symbol?.glyph ?? null };
}

/** The pure half of {@link listRecentLandmarkChats}, for a caller that already loaded both lists. */
export function recentLandmarkChatsFrom(
  input: { summaries: LandmarkSummary[]; sessions: ChatSessionRow[] },
  options: { limit: number; now: number },
): RecentLandmarkChat[] {
  const landmarks = new Map(input.summaries.map((landmark) => [landmark.dir, landmark]));
  const cutoff = options.now - CHAT_FRESH_WINDOW_MS;
  const includedLandmarks = new Set<string>();
  const result: RecentLandmarkChat[] = [];
  for (const session of input.sessions) {
    if (session.mtime.getTime() < cutoff) continue;
    const landmark = chatLandmark(landmarks, session);
    if (landmark === undefined || includedLandmarks.has(landmark.dir)) continue;
    includedLandmarks.add(landmark.dir);
    result.push({ sessionId: session.sessionId, label: session.label, lastActivity: session.mtime.toISOString(), landmark });
    if (result.length === options.limit) break;
  }
  return result;
}

/** Most recently active resumable chats whose bound directory still has a landmark. */
export async function listRecentLandmarkChats(
  boxRoot: string,
  options?: { limit?: number; now?: number },
): Promise<RecentLandmarkChat[]> {
  const [{ summaries }, sessions] = await Promise.all([
    loadLandmarkSummaries(boxRoot),
    loadAllSessions(boxRoot),
  ]);
  return recentLandmarkChatsFrom({ summaries, sessions }, { limit: options?.limit ?? 2, now: options?.now ?? Date.now() });
}

export async function isResumableSession(boxRoot: string, sessionId: string): Promise<boolean> {
  return (await loadAllSessions(boxRoot)).some((session) => session.sessionId === sessionId);
}
