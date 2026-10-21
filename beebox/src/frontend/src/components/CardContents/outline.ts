/**
 * The contents menu's decisions, kept apart from the DOM: which headings a
 * card's contents list holds, when a document is long enough to get one, and
 * which section the reader is in.
 */

/** One heading of the card's document, as the Markdown renderer emitted it. */
export interface OutlineEntry {
  id: string;
  /** 1–6, from the heading tag. */
  level: number;
  text: string;
}

/** An entry with its indent: 0 for the shallowest level the document uses. */
export interface OutlineItem extends OutlineEntry {
  depth: number;
}

/**
 * Fewer headings than this and the document is short enough to scroll; the
 * menu stays out of the way.
 */
const MIN_OUTLINE_ENTRIES = 4;

/** Deeper headings than this are detail, not structure. */
const MAX_OUTLINE_LEVEL = 3;

/** The contents list, or `null` when the document gets no menu. */
export function buildOutline(entries: readonly OutlineEntry[]): OutlineItem[] | null {
  const kept = entries.filter((e) => e.level <= MAX_OUTLINE_LEVEL && e.text.trim() !== "");
  if (kept.length < MIN_OUTLINE_ENTRIES) return null;
  const top = Math.min(...kept.map((e) => e.level));
  return kept.map((e) => ({ ...e, text: e.text.trim(), depth: e.level - top }));
}

/**
 * The section the reader is in: the last heading at or above `line` (the
 * scroller's top plus a little), or `null` above the first heading.
 * `tops` are heading tops in document order, in the same coordinates as `line`.
 */
export function currentSection(tops: readonly { id: string; top: number }[], line: number): string | null {
  let current: string | null = null;
  for (const { id, top } of tops) {
    if (top > line) break;
    current = id;
  }
  return current;
}
