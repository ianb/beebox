/**
 * What the box screen shows (docs/plans/box-screen.md): unfinished quick chat
 * messages, the ones sent in the last day, recent chats, and the box's own
 * shortcut links from `nav.card`.
 */

import { getBoxTime } from "../../../lib/time.js";
import { navRouteFor } from "../../../shared/nav-routes.js";
import { resolveNav, type NavEntryResolved } from "../../nav.js";
import { loadLandmarkSummaries } from "../../landmark/summaries.js";
import { loadAllSessions } from "../session/list/core.js";
import { chatLandmark, recentLandmarkChatsFrom, type RecentLandmarkChat } from "../session/recent-landmark.js";
import { quickChatView, type QuickChatView } from "./quick-chat-record.js";
import { listOpenQuickChatRecords, listRecentlySentQuickChatRecords } from "./quick-chat-store.js";

const RECENTLY_SENT_LIMIT = 5;
const RECENT_CHATS_LIMIT = 5;
/** Routes the box screen already links: its recent chats, "All chats", and the box-wide pages. */
const BOX_SCREEN_ROUTES: ReadonlySet<string> = new Set(["/", "/chat", "/chats", "/browse", "/history", "/dashboard"]);

/** A recent chat on the box screen. Only the last chat can have a null `landmark`: no landmark resolves for its directory. */
export type BoxScreenRecentChat = Omit<RecentLandmarkChat, "landmark"> & { landmark: RecentLandmarkChat["landmark"] | null };

export interface QuickChatHome {
  open: QuickChatView[];
  recentlySent: QuickChatView[];
  recentChats: BoxScreenRecentChat[];
  /** Box-relative paths, without the box prefix. */
  shortcuts: { label: string; to: string }[];
}

/** Project `nav.card` entries onto links; an absent or invalid card has none, as in the menu. */
function shortcutsFrom(entries: NavEntryResolved[]): QuickChatHome["shortcuts"] {
  return entries.flatMap((entry) => {
    if (entry.kind === "ref") return [{ label: entry.label === "" ? entry.target : entry.label, to: `/browse/${entry.target}` }];
    if (BOX_SCREEN_ROUTES.has(entry.target)) return [];
    return [{ label: entry.label === "" ? navRouteFor(entry.target)?.label ?? entry.target : entry.label, to: entry.target }];
  });
}

/**
 * The recent landmark chats, plus the most recently active resumable chat
 * whatever its directory or age, so the box screen always has the last chat.
 * Newest first, one row per session.
 */
async function boxScreenRecentChats(boxRoot: string, now: number): Promise<BoxScreenRecentChat[]> {
  const [{ summaries }, sessions] = await Promise.all([loadLandmarkSummaries(boxRoot), loadAllSessions(boxRoot)]);
  const landmarkChats = recentLandmarkChatsFrom({ summaries, sessions }, { limit: RECENT_CHATS_LIMIT, now });
  // `loadAllSessions` lists newest first, so the last chat leads the rows.
  const last = sessions[0];
  if (last === undefined || landmarkChats.some((chat) => chat.sessionId === last.sessionId)) return landmarkChats;
  const landmarks = new Map(summaries.map((landmark) => [landmark.dir, landmark]));
  const lastChat = { sessionId: last.sessionId, label: last.label, lastActivity: last.mtime.toISOString(), landmark: chatLandmark(landmarks, last) ?? null };
  return [lastChat, ...landmarkChats].slice(0, RECENT_CHATS_LIMIT);
}

export async function quickChatHome(boxRoot: string): Promise<QuickChatHome> {
  const now = getBoxTime(boxRoot).getTime();
  const [open, recentlySent, recentChats, nav] = await Promise.all([
    listOpenQuickChatRecords(boxRoot),
    listRecentlySentQuickChatRecords(boxRoot, { now, limit: RECENTLY_SENT_LIMIT }),
    boxScreenRecentChats(boxRoot, now),
    resolveNav(boxRoot),
  ]);
  return {
    open: open.map((record) => quickChatView(record, now)),
    recentlySent: recentlySent.map((record) => quickChatView(record, now)),
    recentChats,
    shortcuts: nav.status === "ok" ? shortcutsFrom(nav.entries) : [],
  };
}
