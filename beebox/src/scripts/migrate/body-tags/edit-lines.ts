/**
 * Line edits for `plan.ts`: cut block ranges and replace self-closing tags in
 * their source text. Ranges are 0-based, end exclusive, relative to the body.
 */

export type LineEdit =
  | { kind: "remove"; from: number; to: number }
  | { kind: "replace"; from: number; to: number; tag: string; replacement: string };

const SOURCE_TAG = /{%-?\s*(image|silence)\b[^%]*%}/g;

/**
 * The edited body, or `{ reason, index }` (index into the replace edits' order
 * in `edits`) when a span does not hold exactly the tags the parse found.
 * Removing a block also drops the blank lines that would be left doubled.
 */
export function applyLineEdits(lines: readonly string[], edits: readonly LineEdit[]): string | { reason: string; index: number } {
  const kept: Array<string | null> = [...lines];
  const removed = new Set<number>();
  const bySpan = new Map<string, number[]>();
  for (const [index, edit] of edits.entries()) {
    if (edit.kind === "remove") {
      for (let i = edit.from; i < edit.to; i++) { kept[i] = null; removed.add(i); }
    } else {
      const key = `${String(edit.from)}:${String(edit.to)}`;
      bySpan.set(key, [...(bySpan.get(key) ?? []), index]);
    }
  }
  for (const [key, indexes] of bySpan) {
    const [from = 0, to = 0] = key.split(":").map(Number);
    const first = indexes[0] ?? 0;
    const span = lines.slice(from, to).join("\n");
    const matches = [...span.matchAll(SOURCE_TAG)];
    if (matches.length !== indexes.length) return { reason: `expected ${String(indexes.length)} tag(s) in lines ${String(from + 1)}-${String(to)} but found ${String(matches.length)}; rewrite by hand`, index: first };
    let n = 0;
    const rewritten = span.replace(SOURCE_TAG, (whole, name: string) => {
      const edit = edits[indexes[n++] ?? first];
      return edit?.kind === "replace" && edit.tag === name ? edit.replacement : whole;
    });
    kept[from] = rewritten;
    for (let i = from + 1; i < to; i++) kept[i] = null;
  }
  const out: string[] = [];
  let afterRemoval = false;
  for (const [i, line] of kept.entries()) {
    if (line === null) { if (removed.has(i)) afterRemoval = true; continue; }
    if (afterRemoval && line.trim() === "" && (out.length === 0 || out[out.length - 1]?.trim() === "")) continue;
    afterRemoval = false;
    out.push(line);
  }
  return out.join("\n");
}
