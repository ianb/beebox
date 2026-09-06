/**
 * Reading a card's `symbol` group for a consumer that will draw it.
 *
 * Two things happen here that a raw field read does not do: the group is
 * validated (frontmatter reaches some callers unvalidated), and `src` is
 * resolved through the shared ref algebra into the box-relative path the
 * frontend hands to `/api/files`. A `src` that escapes the box yields no image
 * — a visible absence beats emitting a path outside the box.
 *
 * `parseRef`/`resolveRefPath` are not optional here: they own the 3-form ref
 * rule (box-root, attach-scope, document-relative), and a hand-rolled
 * `path.resolve` against the card's directory is exactly the bug that made the
 * same landmark render its icon on one page and a broken image on another
 * (see the history in `core/landmark/symbol.ts`).
 */

import { parseRef, resolveRefPath } from "../shared/ref-path.js";
import { CardSymbol, type CardSymbolData } from "../shared/card-symbol.js";

export function readCardSymbol(value: unknown, { cardPath }: { cardPath: string }): CardSymbolData | null {
  const parsed = CardSymbol.safeParse(value);
  if (!parsed.success) return null;
  const symbol = parsed.data;
  const glyph = symbol.glyph?.trim();
  const withGlyph = glyph === undefined || glyph === "" ? null : { ...symbol, glyph };

  if (symbol.src === undefined || symbol.src === "") return withGlyph;
  const src = resolveRefPath({ fromPath: cardPath, ref: parseRef(symbol.src).path, kind: "card" });
  if (src === null) {
    console.warn(`card symbol: src "${symbol.src}" in ${cardPath} escapes the box`);
    return withGlyph;
  }
  return { ...symbol, ...(glyph === undefined || glyph === "" ? {} : { glyph }), src };
}
