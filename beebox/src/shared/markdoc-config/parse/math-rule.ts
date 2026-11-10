/**
 * Dollar-delimited TeX math for markdown-it: `$…$` inline and `$$…$$` display.
 *
 * The rules see the raw source, before Markdown escapes and emphasis, so the
 * TeX reaches the renderer as written (`\\`, `\{`, `a*b*c` intact). Code spans
 * and fences take precedence: their rules match before these do.
 *
 * Inline `$…$` follows Pandoc's `tex_math_dollars` rule, so prices and shell
 * text stay text: the opening `$` is not followed by whitespace, the closing
 * `$` is not preceded by whitespace and not followed by a digit. "$5 and $10"
 * is text. Inline math does not cross a line break.
 *
 * Display `$$…$$` is a block when a line starts with `$$` and a later line (or
 * the same one) ends with `$$`, with no blank line between; otherwise `$$…$$`
 * inside a paragraph is display math in the line. An unclosed `$$` (a message
 * still streaming) matches nothing and stays text.
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
    if (ch !== "$") continue;
    if (isWhitespace(src[i - 1])) continue;
    if (i + 1 < posMax && isDigit(src[i + 1])) continue;
    return i;
  }
  return -1;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const { src, pos, posMax } = state;
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

// eslint-disable-next-line max-params -- markdown-it's block rule signature is (state, startLine, endLine, silent)
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (lineMark(state.sCount, startLine) - state.blkIndent >= 4) return false;
  const first = lineText(state, startLine).trimEnd();
  if (!first.startsWith("$$")) return false;
  const rest = first.slice(2);

  let closeLine: number;
  let tex: string;
  const sameLineClose = rest.indexOf("$$");
  if (sameLineClose !== -1) {
    // `$$a$$` alone on its line is a block; `$$a$$ and more` is inline.
    if (sameLineClose + 2 !== rest.length) return false;
    closeLine = startLine;
    tex = rest.slice(0, sameLineClose);
  } else {
    const lines = [rest];
    closeLine = -1;
    for (let line = startLine + 1; line < endLine; line++) {
      const text = lineText(state, line).trimEnd();
      if (text.trim() === "") return false;
      if (lineMark(state.sCount, line) < state.blkIndent) return false;
      const end = text.indexOf("$$");
      if (end !== -1) {
        if (end + 2 !== text.length) return false;
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

/** Add the dollar-math rules to a markdown-it instance. */
export function mathPlugin(md: MarkdownIt): void {
  md.inline.ruler.before("escape", "math_inline", mathInline);
  md.block.ruler.before("paragraph", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });
}
