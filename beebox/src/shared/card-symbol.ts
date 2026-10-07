/**
 * A card's symbol: the small mark that stands for it in a tab strip, a listing,
 * or a tile.
 *
 * One grouped field rather than several flat ones, so an author choosing
 * between a glyph and an image sees both keys side by side. `glyph` and `src`
 * are alternatives — a symbol carrying both is a lint warning and `src` wins at
 * render, since an image is the more specific intent.
 *
 * `glyph` is deliberately not restricted to one character: an emoji is often
 * several code points, and an author may want two letters. It IS capped at
 * `MAX_GLYPH_GRAPHEMES` by lint, because a mark that is a sentence is not a
 * mark. See `docs/plans/card-symbol.md`.
 *
 * Lives in `shared/` rather than `cards/` because the frontend draws these and
 * only `shared/` is inside its tsconfig — the same reason `todo-model.ts`, the
 * other global field with a shape, lives here.
 */

import { z } from "zod";
import { parseRef, resolveRefPath } from "./ref-path/core.js";

/**
 * The glyph's length limit, counted in graphemes rather than code points: a
 * single emoji can be ten code points, so a code-point cap set near "one or two
 * marks" would reject legitimate emoji while still admitting junk.
 */
export const MAX_GLYPH_GRAPHEMES = 8;

export const CardSymbol = z.object({
  /** The mark itself: an emoji, or a letter or two. */
  glyph: z.string().optional(),
  /** A box ref to an image, for marks text cannot carry. */
  src: z.string().optional(),
  /** Colours: `#rgb`, `#rrggbb`, `hsl()`, `hsla()`, `rgb()`, `rgba()`. */
  foreground: z.string().optional(),
  background: z.string().optional(),
});

export type CardSymbolData = z.infer<typeof CardSymbol>;

/**
 * Read a card's `symbol` group for a consumer that will draw it.
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
