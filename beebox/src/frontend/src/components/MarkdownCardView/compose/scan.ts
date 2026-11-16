/**
 * Where the marks are in composition source text, for the editor's widgets
 * (`plan:composition-editor`, Track 5). Markdoc decides whether the
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

/** Marks whose words the person can accept as theirs: an agent joiner, or a check on their own words. */
const ACCEPTABLE: ReadonlySet<MarkKind> = new Set(["joiner", "check"]);

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** Wraps each line's words in the delimiters, leaving the line's edge whitespace outside the mark. */
function wrapLines(text: string, { open, close }: { open: string; close: string }): string {
  return text.split("\n").map((line) => {
    const words = line.trim();
    if (words === "") return line;
    const start = line.indexOf(words);
    return `${line.slice(0, start)}${open}${words}${close}${line.slice(start + words.length)}`;
  }).join("\n");
}

/**
 * The changes that accept the person's selection: the words of each joiner
 * or check it covers lose their mark and keep their text. A selection over
 * part of a mark splits it, so only the selected words leave the mark. An
 * empty selection inside a mark accepts the whole mark. Gaps, notes, and
 * source marks are left alone. What stays marked becomes one inline mark per
 * line, so a block mark split this way stays well formed.
 */
export function acceptChanges(text: string, { marks, selection }: { marks: readonly MarkRange[]; selection: { from: number; to: number } }): TextChange[] {
  const changes: TextChange[] = [];
  const cursor = selection.from === selection.to;
  let doneTo = -1;
  for (const mark of marks) {
    if (!ACCEPTABLE.has(mark.kind) || mark.closeTo === mark.closeFrom || mark.openFrom < doneTo) continue;
    const block = text[mark.openTo] === "\n" && text[mark.closeFrom - 1] === "\n" && mark.closeFrom > mark.openTo + 1;
    const contentFrom = mark.openTo + (block ? 1 : 0);
    const contentTo = mark.closeFrom - (block ? 1 : 0);
    let from: number;
    let to: number;
    if (cursor) {
      if (selection.from < mark.openFrom || selection.from > mark.closeTo) continue;
      [from, to] = [contentFrom, contentTo];
    } else {
      [from, to] = [Math.max(selection.from, contentFrom), Math.min(selection.to, contentTo)];
      if (from >= to) continue;
    }
    const delimiters = { open: text.slice(mark.openFrom, mark.openTo), close: text.slice(mark.closeFrom, mark.closeTo) };
    changes.push({ from: mark.openFrom, to: from, insert: wrapLines(text.slice(contentFrom, from), delimiters) });
    changes.push({ from: to, to: mark.closeTo, insert: wrapLines(text.slice(to, contentTo), delimiters) });
    doneTo = mark.closeTo;
    if (cursor) break;
  }
  return changes;
}

/**
 * Joiners left with no words, which a deletion inside one leaves behind:
 * the ranges that remove them, with their spacing (`wholeMarkRange`).
 */
export function emptyJoinerRanges(text: string, marks: readonly MarkRange[]): { from: number; to: number }[] {
  return marks
    .filter((mark) => mark.kind === "joiner" && text.slice(mark.openTo, mark.closeFrom).trim() === "")
    .map((mark) => wholeMarkRange(text, { from: mark.openFrom, to: mark.closeTo }));
}
