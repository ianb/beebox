/**
 * <Markdown> for box views — the app's own renderer, exported from
 * `beebox/view-widgets` as `Markdown`.
 *
 * A box view renders card text with this and nothing else (the view check,
 * `core/views/markdown-check.ts`, rejects the alternatives), so a card's
 * Markdoc tags, refs, images, and todos look and work the same in a box view
 * as on the card's own page. `card` gives relative refs their base and gives
 * todos their card path and file lines, so they are tickable where the view
 * sits under a card view's todo actions (`FileView`).
 *
 * Navigation goes through the view host's `openCard`, as `CardLink` does, so
 * a link opens in whatever surface shows the view (and does nothing in
 * `bbx view test`).
 */

import { useCallback } from "react";
import { Markdown } from "../Markdown";
import { useViewHost } from "../../lib/view-host";
import { serializeViewUrl, type NavigateHint, type ViewTarget } from "../../lib/view-url";

export interface ViewMarkdownProps {
  /** The Markdown text: a card's `body`. */
  children: string;
  /** The card the text is the body of (a `ViewCard` has both fields). */
  card: { path: string; bodyLineOffset: number };
}

export function ViewMarkdown({ children, card }: ViewMarkdownProps) {
  const { openCard } = useViewHost();
  // Markdown hands over a resolved, box-rooted target; `openCard` takes a
  // ref, so the target goes back as a box-absolute ref with its query.
  const onNavigate = useCallback((target: ViewTarget, hint?: NavigateHint) => {
    openCard(`/${serializeViewUrl(target)}`, hint?.label === undefined ? undefined : { label: hint.label });
  }, [openCard]);
  return (
    <Markdown prose="block" onNavigate={onNavigate} basePath={card.path} card={card}>
      {children}
    </Markdown>
  );
}
