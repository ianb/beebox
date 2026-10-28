/**
 * Where the marks are in composition source text, for the editor's widgets
 * (`docs/plans/composition-editor.md`, Track 5). Markdoc decides whether the
 * tags are well formed, but gives inline tags line numbers only, so the
 * character offsets come from pairing the tag delimiters here. When the two
 * disagree, or a tag is unclosed or names an unknown kind, the text is
 * `malformed` and the editor shows it raw.
 */
import { parseMarkdown } from "@shared/markdoc-config/parse/core";
import { EDITORIAL_KINDS } from "@shared/composition/tags";
import { compositionTagMatches } from "@shared/composition/text";

export type MarkKind = (typeof EDITORIAL_KINDS)[number] | "source";

export interface MarkRange {
  kind: MarkKind;
  /** The opening delimiter, `{% editorial … %}` or `{% source … %}`. */
  openFrom: number;
  openTo: number;
  /** The closing delimiter; equal to `openTo` for a self-closing tag. */
  closeFrom: number;
  closeTo: number;
  /** A `check`'s reason, from its `note` attribute. */
  note: string | null;
}

export interface Scan {
  marks: MarkRange[];
  malformed: boolean;
}

const KIND_ATTR = /\bkind\s*=\s*"([^"]*)"/;
const NOTE_ATTR = /\bnote\s*=\s*"((?:[^"\\]|\\.)*)"/;

function attr(attrs: string, pattern: RegExp): string | null {
  return pattern.exec(attrs)?.[1] ?? null;
}

function markdocTagCount(text: string): number | null {
  let count = 0;
  for (const node of parseMarkdown(text).walk()) {
    if (node.type !== "tag" || (node.tag !== "editorial" && node.tag !== "source")) continue;
    if (node.errors.length > 0) return null;
    count += 1;
  }
  return count;
}

const MALFORMED: Scan = { marks: [], malformed: true };

export function scanMarks(text: string): Scan {
  const marks: MarkRange[] = [];
  const open: { name: string; kind: MarkKind; from: number; to: number; note: string | null }[] = [];
  for (const match of compositionTagMatches(text)) {
    const name = match.groups?.["name"] ?? "";
    const attrs = match.groups?.["attrs"] ?? "";
    const from = match.index;
    const to = from + match[0].length;
    if (match.groups?.["close"] !== undefined) {
      const opener = open.pop();
      if (opener?.name !== name) return MALFORMED;
      marks.push({ kind: opener.kind, openFrom: opener.from, openTo: opener.to, closeFrom: from, closeTo: to, note: opener.note });
      continue;
    }
    const kind: MarkKind | undefined = name === "source" ? "source" : EDITORIAL_KINDS.find((k) => k === attr(attrs, KIND_ATTR));
    if (kind === undefined) return MALFORMED;
    const mark = { name, kind, from, to, note: attr(attrs, NOTE_ATTR) };
    if (attrs.trimEnd().endsWith("/")) marks.push({ kind, openFrom: from, openTo: to, closeFrom: to, closeTo: to, note: mark.note });
    else open.push(mark);
  }
  if (open.length > 0 || markdocTagCount(text) !== marks.length) return MALFORMED;
  return { marks: marks.toSorted((a, b) => a.openFrom - b.openFrom), malformed: false };
}

/**
 * The range to delete when a whole mark (gap, note, joiner) is removed, so
 * the spacing left behind matches the rest of the text: a mark alone on its
 * lines takes one neighbouring blank line with it (paragraphs stay one blank
 * line apart), and an inline mark between two spaces takes one of them.
 */
export function wholeMarkRange(text: string, { from, to }: { from: number; to: number }): { from: number; to: number } {
  const startsLine = from === 0 || text[from - 1] === "\n";
  const endsLine = to === text.length || text[to] === "\n";
  if (startsLine && endsLine) {
    if (text.startsWith("\n\n", to)) return { from, to: to + 2 };
    if (from >= 2 && text.startsWith("\n\n", from - 2)) return { from: from - 2, to };
    if (text[to] === "\n") return { from, to: to + 1 };
    return { from: Math.max(0, from - 1), to };
  }
  if (text[from - 1] === " " && (text[to] === " " || endsLine)) return { from: from - 1, to };
  return { from, to };
}
