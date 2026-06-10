/**
 * Excerpt generation around the matched query terms, for search result
 * display. Adapted from ske's generateExcerpt (predecessor project).
 */

const CONTEXT_CHARS = 100;

/**
 * A short window of `content` around the earliest occurrence of any query
 * token, extended to word boundaries, with `...` markers when trimmed.
 * Falls back to the start of the content when nothing matches.
 */
export function generateExcerpt(content: string, query: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);

  let matchIndex = -1;
  let matchLength = 0;
  for (const token of tokens) {
    const i = lower.indexOf(token);
    if (i !== -1 && (matchIndex === -1 || i < matchIndex)) {
      matchIndex = i;
      matchLength = token.length;
    }
  }

  if (matchIndex === -1) {
    const head = normalized.slice(0, CONTEXT_CHARS * 2);
    return head.length < normalized.length ? `${head}...` : head;
  }

  let start = Math.max(0, matchIndex - CONTEXT_CHARS);
  let end = Math.min(normalized.length, matchIndex + matchLength + CONTEXT_CHARS);

  if (start > 0) {
    const space = normalized.lastIndexOf(" ", start);
    if (space > start - 20) start = space + 1;
  }
  if (end < normalized.length) {
    const space = normalized.indexOf(" ", end);
    if (space !== -1 && space < end + 20) end = space;
  }

  let excerpt = normalized.slice(start, end);
  if (start > 0) excerpt = `...${excerpt}`;
  if (end < normalized.length) excerpt = `${excerpt}...`;
  return excerpt;
}
