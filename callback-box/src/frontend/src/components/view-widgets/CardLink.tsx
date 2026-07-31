/**
 * <CardLink> — a barely-styled, surface-correct link to another card.
 *
 * Part of the public `callback-box/view-widgets` set a box-authored view
 * imports. Its job is *behavior*, not chrome: clicking opens the card in
 * whatever surface the view is shown in (chat companion pane, browse, or a full
 * page) via the view host's `openCard`. Appearance stays light so it sits inside
 * author prose. The label falls back to the target's title, then the raw ref.
 *
 * The card reference prop is `cardRef`, not `ref` — React reserves `ref` on
 * function components, so a `ref` prop never reaches us.
 */

import type { ReactNode } from "react";
import { useViewHost, refToTarget } from "../../lib/view-host";
import { serializeViewUrl } from "../../lib/view-url";

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
  const resolved = host.useResolvedRef(cardRef);
  const label = children ?? resolved?.title ?? cardRef;
  const missing = resolved !== null && !resolved.exists;

  // A real href (the card's page URL) so middle-click / open-in-new-tab work;
  // the click handler intercepts for surface-correct in-place opening.
  const target = refToTarget(cardRef, host.basePath);
  if (target === null) {
    // The ref escapes the box root: there is no page URL and nothing to open.
    // Render the label as inert text with the broken marker rather than an
    // anchor that leads to a clamped-to-root card the ref never named.
    return (
      <span title={`Ref escapes the box root: ${cardRef}`}>
        {label}
        <span className="ml-1 text-xs text-danger">(unresolvable)</span>
      </span>
    );
  }
  const href = `/${host.boxSlug}/views/${serializeViewUrl(target)}`;

  return (
    <a
      href={href}
      onClick={(e) => {
        // Let modified clicks (new tab/window) and non-primary buttons behave natively.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        host.openCard(cardRef, {
          label: typeof label === "string" ? label : undefined,
          viewer: view ?? null,
          params,
        });
      }}
      className="underline decoration-warm-400 underline-offset-2 hover:decoration-current"
    >
      {label}
      {missing ? <span className="ml-1 text-xs text-danger">(missing)</span> : null}
    </a>
  );
}
