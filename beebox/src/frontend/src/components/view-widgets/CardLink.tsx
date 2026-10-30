/**
 * <CardLink> — a barely-styled, surface-correct link to another card.
 *
 * Part of the public `beebox/view-widgets` set a box-authored view
 * imports. Its job is *behavior*, not chrome: clicking opens the card in
 * whatever surface the view is shown in (chat companion pane, browse, or a full
 * page) via the view host's `openCard`. Appearance stays light so it sits inside
 * author prose. The label falls back to the target's title, then the raw ref.
 *
 * A link to an image card shows the image in the lightbox, the same as a
 * Markdown link to one (`lib/image-link.ts`); the lightbox's "Open card" opens
 * the card through `openCard`.
 *
 * The card reference prop is `cardRef`, not `ref` — React reserves `ref` on
 * function components, so a `ref` prop never reaches us.
 */

import type { ReactNode } from "react";
import { useViewHost, refToTarget } from "../../lib/view-host";
import { serializeViewUrl } from "../../lib/view-url";
import { toDisplayPath } from "@shared/display-path";
import { imageLinkSrc } from "../../lib/image-link";
import { isPlainLeftClick } from "../../lib/plain-click";
import { useOptionalLightbox } from "../LightboxProvider";

export interface CardLinkProps {
  /** Box-relative card path (box-absolute `/…`, relative, or `attach/…`). */
  cardRef: string;
  /** Optional `?view=` viewer override for the opened card. */
  view?: string;
  /** Optional extra query params for the opened card. */
  params?: Record<string, string>;
  /** Link text; falls back to the target card's title, then the raw ref. */
  children?: ReactNode;
}

export function CardLink({ cardRef, view, params, children }: CardLinkProps) {
  const host = useViewHost();
  const lightbox = useOptionalLightbox();
  const resolved = host.useResolvedRef(cardRef);
  // Only a box-rooted ref (leading `/`) has a display form; attach/relative
  // refs pass through unchanged (display-path.ts is canonical-path-only).
  const displayRef = cardRef.startsWith("/") ? toDisplayPath(cardRef) : cardRef;
  const label = children ?? resolved?.title ?? displayRef;
  const missing = resolved !== null && !resolved.exists;

  // A real href (the card's page URL) so middle-click / open-in-new-tab work;
  // the click handler intercepts for surface-correct in-place opening.
  const target = refToTarget(cardRef, host.basePath);
  if (target === null) {
    // The ref escapes the box root: there is no page URL and nothing to open.
    // Render the label as inert text with the broken marker rather than an
    // anchor that leads to a clamped-to-root card the ref never named.
    return (
      <span title={`Ref escapes the box root: ${displayRef}`}>
        {label}
        <span className="ml-1 text-xs text-danger">(unresolvable)</span>
      </span>
    );
  }
  const href = `/${host.boxSlug}/views/${serializeViewUrl(target)}`;
  const imageSrc = lightbox === null || view !== undefined || target.viewer !== null ? null : imageLinkSrc(host.boxSlug, target.path);
  const openThis = () => {
    host.openCard(cardRef, {
      label: typeof label === "string" ? label : undefined,
      viewer: view ?? null,
      params,
    });
  };
  // The lightbox steps through every image in the document; "Open card" on
  // another one opens that card by its box path.
  const openCard = (cardPath: string) => {
    if (cardPath === target.path) openThis();
    else host.openCard(`/${cardPath}`, { label: cardPath });
  };

  return (
    <a
      href={href}
      data-image-src={imageSrc ?? undefined}
      data-image-alt={imageSrc === null || typeof label !== "string" ? undefined : label}
      data-image-card={imageSrc === null ? undefined : target.path}
      onClick={(e) => {
        // Let modified clicks (new tab/window) and non-primary buttons behave natively.
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        if (imageSrc !== null && lightbox?.openFromElement(e.currentTarget, { openCard }) === true) return;
        openThis();
      }}
      className="bbx-theme-link"
    >
      {label}
      {missing ? <span className="ml-1 text-xs text-danger">(missing)</span> : null}
    </a>
  );
}
