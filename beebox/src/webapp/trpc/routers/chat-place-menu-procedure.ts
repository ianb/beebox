/**
 * `chat.placeMenu` — the app bar's place-switch menu, and nothing else.
 *
 * The menu renders one row per landmark: a symbol, a label, and a count of
 * fresh chats. It was reading `chat.byLandmark`, which builds the full picker
 * payload — every chat in the box, grouped into buckets, each one *named*. The
 * menu discards all of it but the counts (`PlacePill-panels.tsx`'s
 * `SwitchLandmark` is the honest list of what it reads), and naming a chat
 * costs a transcript read. So the bar's menu — the query a page prefetches on
 * load — was the most expensive thing in the app for the least reason.
 *
 * This procedure computes only what the menu draws. `byLandmark` stays as-is
 * for the surfaces that genuinely render session rows with names (the Landmarks
 * page, the chats picker), which are user-initiated navigations rather than
 * something warmed on every page load.
 *
 * Ordering is the menu's contract and is reproduced here exactly: most recently
 * active landmark first (by the bucket's newest chat, fresh or not, so a
 * landmark whose chats are all old still sorts above never-used ones), then
 * root, then alphabetical by label.
 */

import { publicProcedure } from "../trpc.js";
import { listSessionEntries } from "../../../core/chat/session/list.js";
import { CHAT_FRESH_WINDOW_MS } from "../../../core/chat/session/recent-landmark.js";
import { loadLandmarkSummaries, type LandmarkProblem } from "../../../core/landmark/summaries.js";
import { isListedLandmark } from "../../../core/landmark/cascade.js";
import type { CardSymbolData } from "../../../shared/card-symbol.js";

/** One switchable place as the menu draws it. */
export interface PlaceMenuLandmark {
  /**
   * Box-relative path of the landmark card — the row's identity, not `dir`:
   * nothing stops a directory holding two cards, and the client keys on this.
   */
  path: string;
  /** Box-relative directory; "" for the box root. */
  dir: string;
  label: string;
  /** The mark, `src` resolved to a box-relative path; null when there is none. */
  symbol: CardSymbolData | null;
  /** Chats bound here and touched inside the fresh window. */
  freshCount: number;
}

export interface PlaceMenuData {
  landmarks: PlaceMenuLandmark[];
  /**
   * Fresh chats bound to the box root when there is NO root landmark card —
   * the count for the synthetic root row the client adds in that case. Zero
   * when a root landmark exists, since its own row already carries them.
   */
  rootFreshCount: number;
  /**
   * Landmark cards that didn't parse. Surfaced rather than swallowed: once a
   * landmark is the only route to an activity, a hand-edit that breaks its
   * frontmatter must not make it silently vanish from the switcher.
   */
  problems: LandmarkProblem[];
}

/** Per-directory chat activity — the only thing the menu needs from sessions. */
interface DirActivity {
  fresh: number;
  /** Epoch ms of the newest chat in the dir, fresh or not. */
  latest: number;
}

export const chatPlaceMenuProcedure = {
  placeMenu: publicProcedure.query(async ({ ctx }): Promise<PlaceMenuData> => {
    const cutoff = Date.now() - CHAT_FRESH_WINDOW_MS;
    // `listSessionEntries`, not `loadAllSessions`: identity + mtime only, so no
    // transcript is opened to name a chat this menu will never name.
    const [{ summaries, problems }, entries] = await Promise.all([
      loadLandmarkSummaries(ctx.boxRoot),
      listSessionEntries(ctx.boxRoot),
    ]);

    const byDir = new Map<string, DirActivity>();
    for (const entry of entries) {
      // `undefined` (legacy unbound) and "" (explicit root) are the same bucket.
      const dir = entry.contextDir ?? "";
      const at = entry.mtime.getTime();
      const seen = byDir.get(dir);
      if (seen === undefined) byDir.set(dir, { fresh: at >= cutoff ? 1 : 0, latest: at });
      else {
        if (at >= cutoff) seen.fresh += 1;
        if (at > seen.latest) seen.latest = at;
      }
    }

    // Box-wide background cascade: drop a landmark written `background`, and
    // any landmark with a `background` ancestor landmark — the switch menu
    // should not offer a place that folds away everywhere else.
    const visible = summaries.filter((lm) => isListedLandmark(lm, summaries));

    const landmarks: PlaceMenuLandmark[] = visible.map((lm) => ({
      path: lm.path,
      dir: lm.dir,
      label: lm.label,
      symbol: lm.symbol,
      freshCount: byDir.get(lm.dir)?.fresh ?? 0,
    }));

    const latestFor = (dir: string): number | null => byDir.get(dir)?.latest ?? null;
    landmarks.sort((a, b) => {
      const aLatest = latestFor(a.dir);
      const bLatest = latestFor(b.dir);
      if (aLatest !== null && bLatest !== null) return bLatest - aLatest;
      if (aLatest !== null) return -1;
      if (bLatest !== null) return 1;
      if (a.dir === "") return -1;
      if (b.dir === "") return 1;
      return a.label.localeCompare(b.label);
    });

    const hasRootLandmark = visible.some((lm) => lm.dir === "");
    return {
      landmarks,
      rootFreshCount: hasRootLandmark ? 0 : byDir.get("")?.fresh ?? 0,
      problems,
    };
  }),
};
