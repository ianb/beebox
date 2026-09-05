/**
 * Counting what a reader would call characters.
 *
 * A single emoji is routinely several code points — 👨‍👩‍👧‍👦 is seven,
 * Scotland's flag is seven, and a two-person emoji with skin tones reaches ten
 * — so `.length` is the wrong ruler for "is this short?". `Intl.Segmenter` with
 * grapheme granularity is the platform's answer, and is available in every
 * browser this app targets and in Node 20+.
 *
 * Used to enforce the symbol glyph's length cap. Deliberately NOT used to
 * truncate anything: cutting a family emoji at its first grapheme produces a
 * stranger, so an over-long value is refused by lint and clipped by CSS, never
 * silently shortened.
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function countGraphemes(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count++;
  return count;
}
