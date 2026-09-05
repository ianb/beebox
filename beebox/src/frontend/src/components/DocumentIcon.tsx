/**
 * The browser tab's icon: the box's own mark.
 *
 * The served document already carries it, stamped in by the box server
 * (`webapp/index-html.ts`). This is the other half — keeping it right once the
 * app is running, including in dev, where Vite serves the document unstamped.
 *
 * **The icon says which box; the title says which place.** A tab's box is the
 * thing that stays true for the tab's whole life, and the icon is the single
 * glyph a tab strip shows, so that is what it should carry. The landmark for
 * the directory you are in goes in the title instead
 * (`lib/document-title.ts`), where it has room for a name.
 *
 * This was the other way round at first — landmark icon, box only as a
 * fallback — and the cost was the one thing a tab icon exists to prevent: two
 * boxes' tabs wearing the same mark, with nothing left saying which box you
 * were looking at.
 *
 * An image symbol wins over an emoji: the card's author chose a real mark.
 */

import { useEffect } from "react";
import { useParams } from "@tanstack/react-router";
import { emojiFaviconUri } from "@shared/favicon";
import { apiFileUrl } from "../lib/view-url";
import { trpc } from "../lib/trpc";

/**
 * The icon link in the served document, and the app's OWN icon href.
 *
 * The default is not simply what the link said at module load: in production
 * the box server has already stamped that link with the mark of the box that
 * served the document, and switching boxes does not reload the page (so this
 * module is not re-evaluated). Restoring to the stamped href would leave one
 * box's mark on a box that has no mark of its own. The server records the
 * built href in `data-bbx-default-icon` when it stamps, and that is the
 * default when present.
 *
 * There is exactly one writer, so "the default" is unambiguous: no stack,
 * no restore ordering to get wrong.
 */
const iconLink: HTMLLinkElement | null =
  typeof document === "undefined"
    ? null
    : document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
const defaultHref: string | null =
  iconLink === null ? null : iconLink.dataset["bbxDefaultIcon"] || iconLink.href;

function setIcon(href: string | null): void {
  if (iconLink === null || href === null) return;
  if (iconLink.href !== href) iconLink.href = href;
}

/** Renders nothing; owns `<link rel="icon">` for as long as a box is open. */
export function DocumentIcon() {
  const { boxSlug } = useParams({ strict: false });

  // The box's own landmark, not the current directory's. Which box a tab
  // belongs to is the thing that stays true for a tab's whole life, and the
  // icon is the one glyph a tab strip shows -- so the icon carries the box and
  // the title carries the place (`lib/document-title.ts`). Landmark-first
  // icons were the other way round and cost exactly this: two boxes' tabs
  // could wear the same mark while neither said which box it was.
  const boxQuery = trpc.landmarks.forDir.useQuery(
    { dir: "" },
    { enabled: boxSlug !== undefined },
  );

  const mark = boxQuery.data?.landmark ?? null;
  let href: string | null = null;
  if (mark !== null && boxSlug !== undefined) {
    const src = mark.symbol?.src;
    const glyph = mark.symbol?.glyph;
    // A title bar takes a character, never an SVG — which is why the mark's
    // text form is the one that survives into a favicon, colours dropped.
    if (src !== undefined) href = apiFileUrl(boxSlug, src);
    else if (glyph !== undefined && glyph !== "") href = emojiFaviconUri(glyph);
  }

  useEffect(() => {
    setIcon(href ?? defaultHref);
    return () => { setIcon(defaultHref); };
  }, [href]);

  return null;
}
