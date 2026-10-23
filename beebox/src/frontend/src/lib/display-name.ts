import { cardDisplayName } from "@shared/card-name";

/**
 * Filename-derived display name for a box path: a card's `Name.type.card`
 * becomes "Name" with `_`/`-` runs read as spaces (the First_Last authoring
 * convention) — a raw filename is never the headline a user should have to
 * parse (issues/closed/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md).
 * Where a card's frontmatter `title:` is available it wins over this;
 * headers without card data (the browse pane) use this alone.
 */
export function displayName(path: string): string {
  const named = cardDisplayName(path);
  if (named !== null) return named;
  const base = path.split("/").pop();
  return base === undefined || base === "" ? path : base;
}
