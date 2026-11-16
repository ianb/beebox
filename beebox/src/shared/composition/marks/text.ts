/**
 * Composition text transforms that keep what it renders
 * (`plan:composition-editor`, Track 1): whitespace normalization,
 * which the editor applies on each read, and the tag replacement that
 * Copy's forms (`copy.ts`) build on.
 */
import type { Node } from "@markdoc/markdoc";
import { parseMarkdown } from "../../markdoc-config/parse/core.js";
import { tagAttr } from "../tags.js";

interface LineRoles {
  /** Lines written back byte for byte: fences and blockquotes. */
  kept: Set<number>;
  /** Line i is joined to line i + 1 (a soft break inside one paragraph or list item). */
  joinNext: Set<number>;
  /** Line i ends in a hard break made of trailing spaces, which must stay. */
  hardBreak: Set<number>;
}

const TAG_ONLY_LINE = /^\s*{%.*%}\s*$/;
const SPACE_HARD_BREAK = / {2,}$/;
const HARD_BREAK = / {2,}$|\\$/;

function addRange(set: Set<number>, lines: readonly number[]): void {
  const start = lines[0];
  const end = lines[lines.length - 1];
  if (start === undefined || end === undefined) return;
  for (let i = start; i < end; i += 1) set.add(i);
}

function markInline(roles: LineRoles, { node, source }: { node: Node; source: readonly string[] }): void {
  const [start, end] = node.lines;
  if (start === undefined || end === undefined) return;
  for (let i = start; i < end - 1; i += 1) {
    const line = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (HARD_BREAK.test(line)) {
      if (SPACE_HARD_BREAK.test(line)) roles.hardBreak.add(i);
    } else if (!TAG_ONLY_LINE.test(line) && !TAG_ONLY_LINE.test(next)) {
      roles.joinNext.add(i);
    }
  }
}

function lineRoles(text: string, source: readonly string[]): LineRoles {
  const roles: LineRoles = { kept: new Set(), joinNext: new Set(), hardBreak: new Set() };
  const visit = (node: Node): void => {
    if (node.type === "fence" || node.type === "blockquote") {
      addRange(roles.kept, node.lines);
      return;
    }
    for (const child of node.children) {
      if (child.type === "inline" && (node.type === "paragraph" || node.type === "item")) {
        markInline(roles, { node: child, source });
      } else {
        visit(child);
      }
    }
  };
  visit(parseMarkdown(text));
  return roles;
}

/**
 * Join the soft line breaks inside each paragraph and list item, strip
 * trailing spaces except a hard break's, and reduce runs of blank lines to
 * one. Fences, blockquotes, headings, tables, and tag lines keep their line
 * structure. The result renders the same as the input; applying it twice
 * gives the same text.
 */
export function normalizeComposition(text: string): string {
  const source = text.split("\n");
  const roles = lineRoles(text, source);
  const out: { line: string; kept: boolean }[] = [];
  let joining = false;
  for (const [i, raw] of source.entries()) {
    const kept = roles.kept.has(i);
    const trimmed = kept || roles.hardBreak.has(i) ? raw : raw.trimEnd();
    const last = out[out.length - 1];
    if (joining && last !== undefined) {
      last.line = `${last.line} ${trimmed.trimStart()}`;
    } else if (!(trimmed === "" && !kept && last !== undefined && last.line === "" && !last.kept)) {
      out.push({ line: trimmed, kept });
    }
    joining = roles.joinNext.has(i);
  }
  return out.map((entry) => entry.line).join("\n");
}

// One `editorial` or `source` tag: `{% name attrs %}`, `{% /name %}`, or self-closing `{% name attrs /%}`.
const TAG = /{%\s*(?<close>\/)?\s*(?<name>editorial|source)\b(?<attrs>(?:"(?:[^"\\]|\\.)*"|[^"%]|%(?!}))*)%}/g;
// An inline code span on one line: a backtick run, then the same run again.
// A backslash-escaped backtick does not open one (inside a span, a backslash
// is literal, so the closing run may follow one).
const CODE_SPAN = /(?<![\\`])(?<run>`+)(?!`)[^\n]*?(?<!`)\k<run>(?!`)/g;

/**
 * Each `editorial` or `source` tag delimiter in the text, outside inline code
 * spans (Markdoc leaves tag syntax in code as literal text). The compose
 * editor's scan and Copy both find tags through this.
 */
export function compositionTagMatches(text: string): RegExpExecArray[] {
  const spans = [...text.matchAll(CODE_SPAN)].map((m) => [m.index, m.index + m[0].length] as const);
  return [...text.matchAll(TAG)].filter((m) => !spans.some(([from, to]) => m.index >= from && m.index < to));
}

interface Replacement {
  from: number;
  to: number;
  with: string;
}

/**
 * A tag alone on its line wraps a block: its line break goes with it, so the
 * brackets hug the content. Any other tag is replaced in place.
 */
function replacementFor(chunk: string, { match, mark }: { match: RegExpExecArray; mark: string }): Replacement {
  const from = match.index;
  const to = from + match[0].length;
  const lineStart = chunk.lastIndexOf("\n", from - 1) + 1;
  const newline = chunk.indexOf("\n", to);
  const lineEnd = newline === -1 ? chunk.length : newline;
  const alone = chunk.slice(lineStart, from).trim() === "" && chunk.slice(to, lineEnd).trim() === "";
  const closing = match.groups?.["close"] !== undefined;
  // A self-closing tag alone on its line is that line's whole content: it keeps the line break.
  const selfClosing = (match.groups?.["attrs"] ?? "").trimEnd().endsWith("/");
  if (alone && !closing && !selfClosing && newline !== -1) return { from: lineStart, to: newline + 1, with: mark };
  if (alone && closing && lineStart > 0) return { from: lineStart - 1, to: lineEnd, with: mark };
  return { from, to, with: mark };
}

/**
 * Lines that hold a real `editorial` or `source` tag. Markdoc processes tags
 * inside a fence too, so only a `process=false` fence (or other literal text)
 * leaves tag syntax that must stay as written.
 */
function markLines(text: string): Set<number> {
  const lines = new Set<number>();
  for (const node of parseMarkdown(text).walk()) {
    if (node.type !== "tag" || (node.tag !== "editorial" && node.tag !== "source")) continue;
    // Inline: the paragraph's [start, end). Block: [open, open end, close, close end].
    if (node.inline) addRange(lines, node.lines);
    else for (const line of node.lines.filter((_, i) => i % 2 === 0)) lines.add(line);
  }
  return lines;
}

/** One `editorial` or `source` tag as `compositionPlainText` hands it to `mark`; a closer carries its opener's attributes. */
export interface PlainTag {
  name: "editorial" | "source";
  /** The `kind` attribute; `null` on `source`, or when it is missing. */
  kind: string | null;
  note: string | null;
  closing: boolean;
  selfClosing: boolean;
}

/**
 * The composition as plain text for the clipboard. Normalized first, so a
 * hard-wrapped paragraph pastes as one line. Each tag is replaced by what
 * `mark` returns for it: `""` drops the tag and keeps its words. A tag alone
 * on its line takes its line break with it. Other Markdown stays as written.
 */
export function compositionPlainText(text: string, { mark }: { mark: (tag: PlainTag) => string }): string {
  const normalized = normalizeComposition(text);
  const tagLines = markLines(normalized);
  const replacements: Replacement[] = [];
  const open: PlainTag[] = [];
  for (const match of compositionTagMatches(normalized)) {
    const line = normalized.slice(0, match.index).split("\n").length - 1;
    if (!tagLines.has(line)) continue;
    const name = match.groups?.["name"] === "source" ? "source" : "editorial";
    const attrs = match.groups?.["attrs"] ?? "";
    let tag: PlainTag;
    if (match.groups?.["close"] === undefined) {
      tag = { name, kind: tagAttr(attrs, "kind"), note: tagAttr(attrs, "note"), closing: false, selfClosing: attrs.trimEnd().endsWith("/") };
      if (!tag.selfClosing) open.push(tag);
    } else {
      const opener = open.pop();
      tag = { name, kind: opener?.kind ?? null, note: opener?.note ?? null, closing: true, selfClosing: false };
    }
    replacements.push(replacementFor(normalized, { match, mark: mark(tag) }));
  }
  let plain = "";
  let at = 0;
  for (const replacement of replacements) {
    plain += normalized.slice(at, replacement.from) + replacement.with;
    at = replacement.to;
  }
  return plain + normalized.slice(at);
}
