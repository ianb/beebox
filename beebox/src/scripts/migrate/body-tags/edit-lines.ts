/**
 * Line edits for `plan.ts`: cut block ranges and replace self-closing tags in
 * their source text. Ranges are 0-based, end exclusive, relative to the body.
 */

import type { Node } from "@markdoc/markdoc";
import { parseMarkdown } from "../../../shared/markdoc-config/parse/core.js";

export type LineEdit =
  | { kind: "remove"; from: number; to: number }
  | { kind: "replace"; from: number; to: number; tag: string; attributes: Record<string, unknown>; replacement: string };

// A `%` is legal inside a double-quoted attribute value.
const SOURCE_TAG = /{%-?\s*(image|silence)\b(?:"[^"]*"|[^"%])*%}/g;

function tagNodes(node: Node): Node[] {
  return [...(node.type === "tag" ? [node] : []), ...node.children.flatMap(tagNodes)];
}

/** True when `source` parses to exactly one tag node equal to the planned one. */
function sourceMatches(source: string, edit: { tag: string; attributes: Record<string, unknown> }): boolean {
  const nodes = tagNodes(parseMarkdown(source));
  const node = nodes[0];
  return nodes.length === 1 && node?.tag === edit.tag && JSON.stringify(node.attributes) === JSON.stringify(edit.attributes);
}

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
    // A match that is not the next planned tag (a decoy in a code span) stays as written.
    let n = 0;
    const rewritten = span.replace(SOURCE_TAG, (whole) => {
      const edit = edits[indexes[n] ?? first];
      if (n >= indexes.length || edit?.kind !== "replace" || !sourceMatches(whole, edit)) return whole;
      n++;
      return edit.replacement;
    });
    if (n !== indexes.length) return { reason: `the tag text in lines ${String(from + 1)}-${String(to)} does not match what the parse found; rewrite by hand`, index: first };
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
