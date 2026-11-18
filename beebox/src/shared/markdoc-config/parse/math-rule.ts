/**
 * TeX math for markdown-it: `$…$` or `\(…\)` inline and `$$…$$` or `\[…\]`
 * display.
 *
 * The rules see the raw source, before Markdown escapes and emphasis, so the
 * TeX reaches the renderer as written (`\\`, `\{`, `a*b*c` intact). Code spans
 * and fences take precedence: their rules match before these do, and a block's
 * search for its closing line stops at a fence.
 *
 * Inline `$…$` follows Pandoc's `tex_math_dollars` rule, so prices and shell
 * text stay text: the opening `$` is not followed by whitespace, the closing
 * `$` is not preceded by whitespace and not followed by a digit. "$5 and $10"
 * is text. Stricter than Pandoc, the first unescaped `$` after the opener must
 * close it, and a backtick ends the search. Inline math does not cross a line
 * break.
 *
 * Display `$$…$$` is a block when a line starts with `$$` and a later line (or
 * the same one) ends with `$$`, with no blank line between; otherwise `$$…$$`
 * inside a paragraph is display math in the line. An unclosed `$$` (a message
 * still streaming) matches nothing and stays text.
 *
 * `\(…\)` is inline math when the first unescaped `\)` on the same line closes
 * it. `\[…\]` is display math only as a block, with the same line rules as
 * `$$`; inside a sentence, `\[x\]` stays escaped brackets. An unmatched `\(` or
 * `\[` falls through to the escape rule and stays a plain paren or bracket.
 * The rules run before the escape rule, which would otherwise drop the
 * backslash.
 *
 * Tokens: `math_inline` (inline, `meta.display`) and `math_block`, each with
 * the TeX in `content`. `math-tokens.ts` turns them into Markdoc tags.
 */

import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.js";
import type StateBlock from "markdown-it/lib/rules_block/state_block.js";

import { invariant } from "../../invariant.js";

/** `undefined` (past the end) counts as neither. */
function isWhitespace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

/** The index of the closing `$` for an inline span whose opening `$` is at `start`, or -1. */
function findInlineClose(state: StateInline, start: number): number {
  const { src, posMax } = state;
  for (let i = start + 1; i < posMax; i++) {
    const ch = src[i];
    if (ch === "\n") return -1;
    if (ch === "\\") {
      i++;
      continue;
    }
    // A backtick may open a code span, which wins over math.
    if (ch === "`") return -1;
    if (ch !== "$") continue;
    // The first unescaped `$` closes the span or nothing does, so in
    // "$5 and $10; calculate $x$" the price cannot pair with a later formula.
    if (isWhitespace(src[i - 1])) return -1;
    if (i + 1 < posMax && isDigit(src[i + 1])) return -1;
    return i;
  }
  return -1;
}

/** The index of the `\)` closing a `\(` at `start`, or -1. */
function findParenClose(state: StateInline, start: number): number {
  const { src, posMax } = state;
  for (let i = start + 2; i + 1 < posMax; i++) {
    const ch = src[i];
    if (ch === "\n" || ch === "`") return -1;
    if (ch !== "\\") continue;
    if (src[i + 1] === ")") return i;
    if (src[i + 1] === "\n") return -1;
    i++;
  }
  return -1;
}

function mathInlineParen(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src[pos] !== "\\" || src[pos + 1] !== "(") return false;
  const close = findParenClose(state, pos);
  if (close === -1) return false;
  const tex = src.slice(pos + 2, close).trim();
  if (tex === "") return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = tex;
    token.meta = { display: false };
  }
  state.pos = close + 2;
  return true;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
  if (src[pos] === "\\") return mathInlineParen(state, silent);
  if (src[pos] !== "$") return false;

  if (src[pos + 1] === "$") {
    const close = src.indexOf("$$", pos + 2);
    if (close === -1 || close + 2 > posMax) return false;
    const tex = src.slice(pos + 2, close);
    if (tex.trim() === "") return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = tex.trim();
      token.meta = { display: true };
    }
    state.pos = close + 2;
    return true;
  }

  if (pos + 1 >= posMax || isWhitespace(src[pos + 1])) return false;
  const close = findInlineClose(state, pos);
  if (close === -1) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = src.slice(pos + 1, close);
    token.meta = { display: false };
  }
  state.pos = close + 1;
  return true;
}

/** A per-line array entry markdown-it keeps for every line of the block. */
function lineMark(marks: number[], line: number): number {
  const mark = marks[line];
  invariant(mark !== undefined, `markdown-it block state has no mark for line ${String(line)}`);
  return mark;
}

function lineText(state: StateBlock, line: number): string {
  return state.src.slice(lineMark(state.bMarks, line) + lineMark(state.tShift, line), lineMark(state.eMarks, line));
}

/** Block delimiters: an opener and the closer it pairs with. */
const BLOCK_DELIMITERS = [
  ["$$", "$$"],
  ["\\[", "\\]"],
] as const;

/**
 * Where `closer` starts in `text`, or -1. `\]` counts only after an even run
 * of backslashes, so a TeX row break `\\` before a literal `]` is not a closer.
 */
function findCloser(text: string, closer: string): number {
  if (closer === "$$") return text.indexOf(closer);
  for (let i = 0; i + 1 < text.length; i++) {
    if (text[i] !== "\\") continue;
    if (text[i + 1] === "]") return i;
    i++;
  }
  return -1;
}

/** A fence line ends the search: a closer inside code is not math. */
function isFence(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("```") || trimmed.startsWith("~~~");
}

// eslint-disable-next-line max-params -- markdown-it's block rule signature is (state, startLine, endLine, silent)
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (lineMark(state.sCount, startLine) - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine).trimEnd();
  const delimiters = BLOCK_DELIMITERS.find(([open]) => first.startsWith(open));
  if (delimiters === undefined) return false;
  const [opener, closer] = delimiters;
  const rest = first.slice(opener.length);

  let closeLine: number;
  let tex: string;
  const sameLineClose = findCloser(rest, closer);
  if (sameLineClose !== -1) {
    // `$$a$$` alone on its line is a block; `$$a$$ and more` is inline.
    if (sameLineClose + closer.length !== rest.length) return false;
    closeLine = startLine;
    tex = rest.slice(0, sameLineClose);
  } else {
    const lines = [rest];
    closeLine = -1;
    for (let line = startLine + 1; line < endLine; line++) {
      const text = lineText(state, line).trimEnd();
      if (text.trim() === "" || isFence(text)) return false;
      if (lineMark(state.sCount, line) < state.blkIndent) return false;
      const end = findCloser(text, closer);
      if (end !== -1) {
        if (end + closer.length !== text.length) return false;
        lines.push(text.slice(0, end));
        closeLine = line;
        break;
      }
      lines.push(text);
    }
    if (closeLine === -1) return false;
    tex = lines.join("\n");
  }
  if (tex.trim() === "") return false;
  if (silent) return true;

  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = tex.trim();
  token.map = [startLine, closeLine + 1];
  state.line = closeLine + 1;
  return true;
}

/** Add the math rules to a markdown-it instance. */
export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("paragraph", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
}
