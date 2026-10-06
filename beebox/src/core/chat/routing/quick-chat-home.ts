/**
 * What the box screen shows (docs/plans/box-screen.md): unfinished quick chat
 * messages, the ones sent in the last day, recent chats, and the box's own
 * shortcut links from `nav.card`.
 */

import { getBoxTime } from "../../../lib/time.js";
import { navRouteFor } from "../../../shared/nav-routes.js";
import { resolveNav, type NavEntryResolved } from "../../nav.js";
import { listRecentLandmarkChats, type RecentLandmarkChat } from "../session/recent-landmark.js";
import { quickChatView, type QuickChatView } from "./quick-chat-record.js";
import { listOpenQuickChatRecords, listRecentlySentQuickChatRecords } from "./quick-chat-store.js";

const RECENTLY_SENT_LIMIT = 5;
const RECENT_CHATS_LIMIT = 5;
/** Routes the box screen already links: its recent chats, "All chats", and the box-wide pages. */
const BOX_SCREEN_ROUTES: ReadonlySet<string> = new Set(["/", "/chat", "/chats", "/browse", "/history", "/dashboard"]);

export interface QuickChatHome {
  open: QuickChatView[];
  recentlySent: QuickChatView[];
  recentChats: RecentLandmarkChat[];
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

export async function quickChatHome(boxRoot: string): Promise<QuickChatHome> {
  const now = getBoxTime(boxRoot).getTime();
  const [open, recentlySent, recentChats, nav] = await Promise.all([
    listOpenQuickChatRecords(boxRoot),
    listRecentlySentQuickChatRecords(boxRoot, { now, limit: RECENTLY_SENT_LIMIT }),
    listRecentLandmarkChats(boxRoot, { limit: RECENT_CHATS_LIMIT, now }),
    resolveNav(boxRoot),
  ]);
  return {
    open: open.map((record) => quickChatView(record, now)),
    recentlySent: recentlySent.map((record) => quickChatView(record, now)),
    recentChats,
    shortcuts: nav.status === "ok" ? shortcutsFrom(nav.entries) : [],
  };
}
