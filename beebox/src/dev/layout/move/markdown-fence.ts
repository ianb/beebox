/**
 * Fenced-code-block detection for Markdown (```` ``` ```` or `~~~`), so
 * `mention-annotate.ts` can skip runnable examples entirely instead of
 * inserting a note into them. Line-based, per CommonMark: an opening fence is
 * a run of 3+ backticks or tildes (optionally indented up to 3 spaces,
 * optionally followed by an info string); a closing fence is a line
 * containing only a run of the same character, at least as long.
 */
export interface CharRange {
  start: number;
  end: number;
}

function fenceOpen(line: string): { char: string; len: number } | null {
  const trimmed = line.replace(/^ {0,3}/, "");
  const char = trimmed[0];
  if (char !== "`" && char !== "~") return null;
  let len = 0;
  while (trimmed[len] === char) len++;
  return len >= 3 ? { char, len } : null;
}

function fenceCloses(line: string, open: { char: string; len: number }): boolean {
  const trimmed = line.trim();
  if (trimmed.length < open.len) return false;
  for (const c of trimmed) if (c !== open.char) return false;
  return true;
}

/** Character ranges (`[start, end)`, covering the fence lines themselves) that are inside a fenced code block. */
export function fencedRanges(text: string): CharRange[] {
  const ranges: CharRange[] = [];
  let offset = 0;
  let open: { char: string; len: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    if (open === null) {
      const marker = fenceOpen(line);
      if (marker !== null) open = { ...marker, start: offset };
    } else if (fenceCloses(line, open)) {
      ranges.push({ start: open.start, end: lineEnd });
      open = null;
    }
    offset = lineEnd + 1;
  }
  if (open !== null) ranges.push({ start: open.start, end: text.length });
  return ranges;
}

export function isInsideRanges(pos: number, ranges: readonly CharRange[]): boolean {
  return ranges.some((r) => pos >= r.start && pos < r.end);
}
