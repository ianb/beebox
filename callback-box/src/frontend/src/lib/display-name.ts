/**
 * Filename-derived display name for a box path: a card's `Name.type.card`
 * becomes "Name" with underscores read as spaces (the First_Last authoring
 * convention) — a raw filename is never the headline a user should have to
 * parse (issues/bugs/2026-08-08-implementation-vocab-leaks-into-ui.md).
 * Where a card's frontmatter `title:` is available it wins over this;
 * headers without card data (the browse pane) use this alone.
 */
export function displayName(path: string): string {
  const base = path.split("/").pop();
  if (base === undefined || base === "") return path;
  const cardName = base.match(/^(.+)\.[^.]+\.card$/)?.[1];
  if (cardName !== undefined) return cardName.replace(/[_-]+/g, " ");
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}
