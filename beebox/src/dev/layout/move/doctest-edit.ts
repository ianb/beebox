/**
 * Rewrites import specifiers inside a `.doctest.md` file's fenced ```ts
 * blocks. Each fence's interior text is real TypeScript on its own (a
 * `continue` block builds on a prior block's scope, but that doesn't affect
 * parsing import/export/dynamic-import statements), so it is parsed and
 * located the same way `ts-edit.ts` locates them in a plain `.ts` file —
 * by AST position, not a line regex, so a fenced string that merely
 * *contains* specifier-shaped text (a scanner doctest's own fixture data,
 * for instance) is never mistaken for a real import.
 */
import { parseSourceFile } from "../scan/imports.js";
import { specifierLiteralsOf } from "./ts-edit.js";

const FENCE_START = /^```ts\b/;
const FENCE_END = /^```\s*$/;

interface Fence {
  /** Offset of the fence's interior text within the full document. */
  start: number;
  text: string;
}

function findFences(text: string): Fence[] {
  const fences: Fence[] = [];
  let offset = 0;
  let interiorStart: number | null = null;
  let interiorLines: string[] = [];
  for (const line of text.split("\n")) {
    if (interiorStart === null) {
      if (FENCE_START.test(line)) {
        interiorStart = offset + line.length + 1;
        interiorLines = [];
      }
    } else if (FENCE_END.test(line)) {
      fences.push({ start: interiorStart, text: interiorLines.join("\n") });
      interiorStart = null;
    } else {
      interiorLines.push(line);
    }
    offset += line.length + 1;
  }
  return fences;
}

export function rewriteDoctestFile(params: { text: string; rewrites: ReadonlyMap<string, string> }): string {
  const edits: Array<{ start: number; end: number; newSpecifier: string }> = [];
  for (const fence of findFences(params.text)) {
    const sourceFile = parseSourceFile({ fileName: "fence.ts", sourceText: fence.text });
    for (const literal of specifierLiteralsOf(sourceFile)) {
      const newSpecifier = params.rewrites.get(literal.text);
      if (newSpecifier === undefined) continue;
      edits.push({ start: fence.start + literal.start, end: fence.start + literal.end, newSpecifier });
    }
  }
  if (edits.length === 0) return params.text;
  const sorted = edits.toSorted((a, b) => b.start - a.start); // back to front
  let text = params.text;
  for (const edit of sorted) {
    const quote = text[edit.start] ?? '"';
    text = text.slice(0, edit.start) + quote + edit.newSpecifier + quote + text.slice(edit.end);
  }
  return text;
}
