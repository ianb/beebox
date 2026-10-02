/**
 * One-pass renderer for the agent guide's source (`guide.md`): fills each
 * `{{placeholder}}` from its filler, drops the header comment and every
 * `<!-- rules: ... -->` citation, and tags each output line with its section
 * and the rows citing it, so the linter (`lint.ts`) reads the same pass the
 * box gets. The annotated form keeps the comments; the stripped form is what
 * `generateDocs` writes (through `withDocId`).
 */

/** One line of the rendered guide. */
export interface GuideLine {
  text: string;
  /** The handle of the `## ` section the line sits under; null in the preamble. */
  section: string | null;
  /** Ids of the ledger rows whose citation covers this line; empty when uncited. */
  rules: string[];
  /** A comment the stripped form drops: the header comment or a rules citation. */
  comment: boolean;
  /** The document's own text, or text a placeholder's filler produced. */
  origin: "document" | "filler";
}

/**
 * A placeholder's filler. A line-level placeholder (alone on its line) takes
 * any number of lines; an empty string removes the line. `null` omits the
 * whole `## ` section the placeholder sits in (an empty per-box list).
 */
export type Filler = () => string | null;

/** A citation line: `<!-- rules: a.b, c.d -->`. */
/** A fence opener or closer: three or more backticks or tildes at the line start. */
const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;
const RULES_LINE = /^<!-- rules: (.+) -->$/;
const LINE_PLACEHOLDER = /^{{([_a-z]+)}}$/;
const INLINE_PLACEHOLDER = /{{([_a-z]+)}}/g;
const SECTION_HEADING = /^## (\S+)/;

class UnknownPlaceholderError extends Error {
  constructor(name: string) {
    super(`guide.md names {{${name}}}, which has no filler`);
    this.name = "UnknownPlaceholderError";
  }
}

class InlineOmitError extends Error {
  constructor(name: string) {
    super(`{{${name}}} sits inside a line, so its filler cannot omit the section`);
    this.name = "InlineOmitError";
  }
}

/** The ids a rules citation names. */
function citedIds(line: string): string[] {
  const list = RULES_LINE.exec(line)?.[1] ?? "";
  return list.split(",").map((id) => id.trim()).filter((id) => id !== "");
}

/** How many leading lines are the header comment (and the blank lines after it). */
function headerLength(lines: string[]): number {
  if (lines[0] !== "<!--") return 0;
  const close = lines.indexOf("-->");
  if (close === -1) return 0;
  let end = close + 1;
  while (lines[end] === "") end++;
  return end;
}

function fill(name: string, fillers: Readonly<Record<string, Filler>>): string | null {
  const filler = fillers[name];
  if (filler === undefined) throw new UnknownPlaceholderError(name);
  return filler();
}

/** Render `source` line by line; see {@link GuideLine}. */
export function renderGuideLines(params: { source: string; fillers: Readonly<Record<string, Filler>> }): GuideLine[] {
  const { source, fillers } = params;
  const lines = source.replace(/\n+$/, "").split("\n");
  const header = headerLength(lines);
  const out: GuideLine[] = lines.slice(0, header).map((text) => ({ text, section: null, rules: [], comment: true, origin: "document" }));
  const omitted = new Set<string | null>();
  let section: string | null = null;
  let rules: string[] = [];
  let skipBlank = false;
  // Inside a fenced code block a blank line does not end the cited passage,
  // a heading-shaped line is not a heading, and a line that looks like a
  // rules comment is example text to keep.
  let inFence = false;

  for (const text of lines.slice(header)) {
    if (FENCE_LINE.test(text)) inFence = !inFence;
    if (inFence) {
      out.push({ text, section, rules, comment: false, origin: "document" });
      continue;
    }
    const heading = SECTION_HEADING.exec(text)?.[1];
    if (heading !== undefined) section = heading;
    if (text === "" || heading !== undefined) rules = [];
    if (text === "" && skipBlank) {
      skipBlank = false;
      continue;
    }
    skipBlank = false;
    if (RULES_LINE.test(text)) {
      rules = citedIds(text);
      out.push({ text, section, rules, comment: true, origin: "document" });
      continue;
    }
    const lineName = LINE_PLACEHOLDER.exec(text)?.[1];
    if (lineName !== undefined) {
      const filled = fill(lineName, fillers);
      if (filled === null) omitted.add(section);
      else if (filled === "") skipBlank = out.findLast((l) => !l.comment)?.text === "";
      else for (const t of filled.split("\n")) out.push({ text: t, section, rules, comment: false, origin: "filler" });
      continue;
    }
    const filledLine = text.replace(INLINE_PLACEHOLDER, (_match, name: string) => {
      const filled = fill(name, fillers);
      if (filled === null) throw new InlineOmitError(name);
      return filled;
    });
    out.push({ text: filledLine, section, rules, comment: false, origin: "document" });
  }
  return out.filter((line) => !omitted.has(line.section));
}

/** The form a box gets: comments dropped, no trailing newline. */
export function strippedText(lines: GuideLine[]): string {
  return lines.filter((l) => !l.comment).map((l) => l.text).join("\n").replace(/\n+$/, "");
}

/** The filled form with every comment kept, for reading citations against the text. */
export function annotatedText(lines: GuideLine[]): string {
  return lines.map((l) => l.text).join("\n").replace(/\n+$/, "");
}
