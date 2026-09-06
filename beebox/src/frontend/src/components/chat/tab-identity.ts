/**
 * What a sidecar tab shows: a mark, an abbreviation, or a title.
 *
 * A pinned tab is compact by design, so it has room for one of those, not all
 * three. The rule (boxholder, 2026-09-05): an unambiguous mark stands in for
 * the title entirely, browser-pinned-tab style; an ambiguous one is joined by a
 * short abbreviation; a card with no mark shows the abbreviation alone.
 *
 * **Ambiguity is scoped to the pinned tabs, and that is the load-bearing
 * choice.** The pinned set changes only when someone pins, unpins, or closes a
 * pinned tab — all deliberate acts. Scoping it to every open tab instead would
 * make a card's face change because you opened something unrelated, which is an
 * identity that depends on what else is on screen.
 */

import { countGraphemes } from "@shared/graphemes";
import type { CardSymbolData } from "@shared/card-symbol";

/**
 * A short stand-in for a title: the initials of its first two words, or the
 * first two graphemes of a single word. The chat-avatar convention, and the
 * reason Track B exists — it runs on the card's title, not on its filename.
 */
export function abbreviateTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  if (words.length === 1) return firstGraphemes(words[0] ?? "", 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => firstGraphemes(word, 1))
    .join("")
    .toUpperCase();
}

function firstGraphemes(value: string, count: number): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let out = "";
  let taken = 0;
  for (const { segment } of segmenter.segment(value)) {
    if (taken >= count) break;
    out += segment;
    taken++;
  }
  return out;
}

/**
 * The marks worn by more than one pinned tab. A tab whose mark is in this set
 * cannot stand alone, because it no longer says which card it is.
 *
 * Compares whole glyphs, not first graphemes: 🍞 and 🍞🥖 are different marks,
 * and an author who wrote two of them meant them to differ. Image marks are
 * keyed too — `src` is only a path, so two cards can name the same picture.
 */
export function markKey(symbol: CardSymbolData | null): string | null {
  const src = symbol?.src?.trim();
  if (src !== undefined && src !== "") return `src:${src}`;
  const glyph = symbol?.glyph?.trim();
  if (glyph !== undefined && glyph !== "") return `glyph:${glyph}`;
  return null;
}

export function ambiguousMarks(pinned: Array<{ symbol: CardSymbolData | null }>): ReadonlySet<string> {
  const seen = new Map<string, number>();
  for (const tab of pinned) {
    const key = markKey(tab.symbol);
    if (key === null) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [key, count] of seen) if (count > 1) out.add(key);
  return out;
}

/** What a pinned tab draws: its mark, an abbreviation, or both. */
export interface PinnedFace {
  mark: CardSymbolData | null;
  abbreviation: string | null;
}

export function pinnedFace(input: {
  symbol: CardSymbolData | null;
  title: string;
  ambiguous: ReadonlySet<string>;
}): PinnedFace {
  const { symbol, title, ambiguous } = input;
  const key = markKey(symbol);
  if (key === null) return { mark: null, abbreviation: abbreviateTitle(title) };
  if (!ambiguous.has(key)) return { mark: symbol, abbreviation: null };
  return { mark: symbol, abbreviation: abbreviateTitle(title) };
}

/** Whether a glyph is short enough to sit beside an abbreviation without crowding it. */
export function isCompactGlyph(glyph: string): boolean {
  return countGraphemes(glyph) <= 2;
}
