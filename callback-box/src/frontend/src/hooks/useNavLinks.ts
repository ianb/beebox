/**
 * Nav links for AppNav, driven by the box's `nav.card` when one exists.
 *
 * Resolution comes from `trpc.nav.get` (see src/core/nav.ts). An absent or
 * invalid card yields the builtin fallback nav — the pre-nav-card hardcoded
 * list, now serving as the can't-break floor (an invalid card additionally
 * surfaces as a health warning; nothing here improvises UI). A file-change
 * event on `nav.card` refetches, so an agent edit reshapes the nav live.
 * See docs/implemented-plans/nav-card.md.
 */

import { useCallback } from "react";
import { DEFAULT_NAV_HREFS, navRouteFor } from "@shared/nav-routes";
import { trpc } from "../lib/trpc";
import { busEventData } from "../lib/bus-events";
import { useBusSubscription, type RealtimeEvent } from "./useBusSubscription";

export interface NavLink {
  to: string;
  label: string;
  match: (pathname: string) => boolean;
  badge?: number;
}

/**
 * Segment-boundary matcher: `/chat` matches `/chat`, `/chat?x`, `/chat/y`
 * but never `/chats`. Root (`/`) matches only the box home.
 */
function matchFor(base: string, hrefPath: string): (p: string) => boolean {
  if (hrefPath === "/") return (p) => p === base || p === `${base}/`;
  const full = `${base}${hrefPath}`;
  return (p) => p === full || p.startsWith(`${full}?`) || p.startsWith(`${full}/`);
}

function hrefLink(input: { base: string; hrefPath: string; label?: string; badgeCounts: Map<string, number> }): NavLink {
  const { base, hrefPath, label, badgeCounts } = input;
  const link: NavLink = {
    to: hrefPath === "/" ? `${base}/` : `${base}${hrefPath}`,
    label: label ?? navRouteFor(hrefPath)?.label ?? hrefPath,
    match: matchFor(base, hrefPath),
  };
  // Route-bound badges (chat freshness, pending questions) until card types
  // grow a nav form of their own (docs/plans/interface-as-cards.md).
  const badge = badgeCounts.get(hrefPath);
  if (badge !== undefined) link.badge = badge;
  return link;
}

export function useNavLinks({
  base,
  freshCount,
  pendingQuestions,
}: {
  base: string;
  freshCount: number;
  pendingQuestions: number;
}): NavLink[] {
  const utils = trpc.useUtils();
  const navQuery = trpc.nav.get.useQuery();

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

  const badgeCounts = new Map<string, number>([["/chats", freshCount], ["/questions", pendingQuestions]]);

  const nav = navQuery.data;
  if (nav === undefined || nav.status !== "ok") {
    // Absent, invalid, or still loading — the builtin fallback nav.
    return DEFAULT_NAV_HREFS.map((hrefPath) => hrefLink({ base, hrefPath, badgeCounts }));
  }

  return nav.entries.map((entry) => {
    if (entry.kind === "href") {
      return hrefLink({ base, hrefPath: entry.target, label: entry.label, badgeCounts });
    }
    const to = `${base}/browse/${entry.target}`;
    return {
      to,
      label: entry.label,
      match: (p: string) => p === to || p.startsWith(`${to}?`),
    };
  });
}
