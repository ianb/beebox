/**
 * The browser tab's icon, following the place you're in.
 *
 * The served document already carries the box's own mark, stamped in by the
 * box server (`webapp/index-html.ts`). This is the other half: once the app is
 * running, the icon tracks the landmark for the directory you're actually in,
 * and falls back to the box's own when that directory has none.
 *
 * Landmark first, box second — the same ordering as the tab title, and for the
 * same reason: within one box the place is what distinguishes two tabs. The
 * cost is real and worth naming, because unlike the title there is no room for
 * both: a tab deep in a landmarked directory shows that landmark's mark, not
 * the box's, so two boxes' tabs can wear the same icon.
 *
 * Both marks come from the same `landmarks.forDir` query the app bar's place
 * pill already runs, so the current directory's lookup is a react-query cache
 * hit rather than a second request. Only the box-root lookup is extra, and it
 * is one small query per session.
 *
 * A landmark with an image symbol wins over its own emoji -- the card author
 * chose a real mark. A landmark carrying NO symbol is skipped rather than
 * honoured: it is saying nothing about marks, so the box's own is the better
 * answer, and relying on the document's stamped icon for that would behave
 * differently in dev (where the document is served by Vite, unstamped).
 */

import { useEffect } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { emojiFaviconUri } from "@shared/favicon";
import { placeLabel } from "../lib/place-label";
import { apiFileUrl } from "../lib/view-url";
import { trpc } from "../lib/trpc";

/**
 * The icon link in the served document, and the href it arrived with.
 *
 * Captured once, before anything rewrites it, so leaving a box (to the login
 * page, say) can put the document back the way it came rather than stranding
 * one box's mark on a page that has no box. There is exactly one writer, so
 * "the original" is unambiguous — no stack, no restore ordering to get wrong.
 */
const iconLink: HTMLLinkElement | null =
  typeof document === "undefined"
    ? null
    : document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
const builtInHref: string | null = iconLink === null ? null : iconLink.href;

function setIcon(href: string | null): void {
  if (iconLink === null || href === null) return;
  if (iconLink.href !== href) iconLink.href = href;
}

/** Renders nothing; owns `<link rel="icon">` for as long as a box is open. */
export function DocumentIcon() {
  const { boxSlug } = useParams({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const place = placeLabel({ pathname, boxSlug: boxSlug ?? "" });
  const dir = place.dir;

  // Same query key as the place pill's, so this is its cache entry.
  const hereQuery = trpc.landmarks.forDir.useQuery(
    { dir: dir ?? "" },
    { enabled: boxSlug !== undefined && dir !== null },
  );
  const boxQuery = trpc.landmarks.forDir.useQuery(
    { dir: "" },
    { enabled: boxSlug !== undefined },
  );

  const here = dir === null ? null : hereQuery.data?.landmark ?? null;
  const box = boxQuery.data?.landmark ?? null;
  // First one that actually carries a mark, nearest place first.
  const marked = [here, box].filter((l) => l !== null);
  const mark = marked.find((l) => l.symbolSrc !== null || l.symbol !== "") ?? null;

  let href: string | null = null;
  if (mark !== null && boxSlug !== undefined) {
    href = mark.symbolSrc !== null ? apiFileUrl(boxSlug, mark.symbolSrc) : emojiFaviconUri(mark.symbol);
  }

  useEffect(() => {
    setIcon(href ?? builtInHref);
    return () => { setIcon(builtInHref); };
  }, [href]);

  return null;
}
