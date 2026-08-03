/**
 * The box's `nav.card` entries, projected onto the switch menu's custom
 * section (docs/implemented-plans/nav-card.md, relocated by
 * docs/plans/top-nav-ia.md Track C3).
 *
 * This is what's left of the retired `useNavLinks`: the `trpc.nav.get` query
 * and the file-change subscription that made an agent's edit to `nav.card`
 * reshape the nav live. The fallback list is gone — a box without a card gets
 * no section, because the menu's builtin rows already carry every route the
 * old fallback named. An invalid card also renders nothing here; it surfaces
 * as a health warning (`core/nav.ts`), which is where it always belonged.
 *
 * Like `chat.byLandmark`, the query is gated behind the menu's first open:
 * the bar mounts on every page and must not fetch for a menu nobody opened.
 */

import { useCallback } from "react";
import { trpc } from "../lib/trpc";
import { busEventData } from "../lib/bus-events";
import { navMenuEntries, type NavMenuEntry } from "../lib/nav-menu-entries";
import { useBusSubscription, type RealtimeEvent } from "./useBusSubscription";

export function useNavMenuEntries({ base, enabled }: { base: string; enabled: boolean }): NavMenuEntry[] {
  const utils = trpc.useUtils();
  const navQuery = trpc.nav.get.useQuery(undefined, { enabled });

  useBusSubscription({
    onEvent: useCallback(
      (event: RealtimeEvent) => {
        const change = busEventData(event, "file-change");
        if (!change || change.path !== "nav.card") return;
        void utils.nav.get.invalidate();
      },
      [utils],
    ),
  });

  const nav = navQuery.data;
  if (nav === undefined || nav.status !== "ok") return [];
  return navMenuEntries({ entries: nav.entries, base });
}
