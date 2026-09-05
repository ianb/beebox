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
 */

import { z } from "zod";

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
