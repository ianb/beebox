/**
 * Selection color pairs in theme CSS. `::selection` (themes/chrome.css) reads
 * a background token and its ink; a rule that sets one without the other
 * leaves the ink to another rule's pair, chosen for a different background.
 * This reads the source, so it covers every stock and scope; the rendered
 * check (`bin/theme-check`) measures the pairs that nesting produces.
 */

import { contrastRatio } from "./contrast.js";

/** Each selection background and the ink that `::selection` draws on it. */
export const SELECTION_PAIRS = [
  ["--bbx-selection", "--bbx-selection-ink"],
  ["--bbx-selection-code", "--bbx-selection-code-ink"],
] as const;

/** WCAG AA for normal text. */
const NORMAL = 4.5;

export interface DeclarationBlock {
  file: string;
  line: number;
  selector: string;
  /** Custom properties the block declares, last one winning. */
  tokens: Map<string, string>;
}

/**
 * The blocks of a stylesheet that declare properties, with the custom
 * properties each sets. Comments and quoted strings are skipped; an at-rule
 * holds blocks but is not one.
 */
export function declarationBlocks(css: string, file: string): DeclarationBlock[] {
  // Comments become spaces, newlines kept, so offsets still give lines.
  const source = css.replaceAll(/\/\*[\S\s]*?\*\//g, (comment) => comment.replaceAll(/[^\n]/g, " "));
  const lineAt = (offset: number) => source.slice(0, offset).split("\n").length;
  const blocks: DeclarationBlock[] = [];
  const open: { selector: string; line: number; start: number }[] = [];
  // Where the text before the next "{" begins: after the last "{", "}" or ";".
  let headStart = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\"" || c === "'") {
      i = source.indexOf(c, i + 1);
      if (i === -1) break;
      continue;
    }
    if (c === "{") {
      const head = source.slice(headStart, i);
      const lead = head.length - head.trimStart().length;
      open.push({ selector: head.trim(), line: lineAt(headStart + lead), start: i + 1 });
      headStart = i + 1;
    } else if (c === "}") {
      const block = open.pop();
      if (block !== undefined && !block.selector.startsWith("@")) {
        const tokens = new Map<string, string>();
        for (const decl of source.slice(block.start, i).replaceAll(/[^{}]*{[^{}]*}/g, ";").split(";")) {
          const match = /^\s*(--[\w-]+)\s*:\s*([\S\s]*?)\s*$/.exec(decl);
          if (match?.[1] !== undefined && match[2] !== undefined) tokens.set(match[1], match[2].replace(/\s*!important$/, ""));
        }
        blocks.push({ file, line: block.line, selector: block.selector, tokens });
      }
      headStart = i + 1;
    } else if (c === ";") {
      headStart = i + 1;
    }
  }
  return blocks;
}

/** A hex color as sRGB bytes; anything else (var(), initial, color-mix()) is null. */
function hex(value: string): [number, number, number] | null {
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if (m?.[1] === undefined) return null;
  const h = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1];
  const byte = (k: number) => parseInt(h.slice(k, k + 2), 16);
  return [byte(0), byte(2), byte(4)];
}

/**
 * One line per problem: a block that sets half a pair, or a pair of hex colors
 * below AA. A pair given as var() or reset with `initial` is measured where it
 * renders.
 */
export function selectionPairProblems(blocks: readonly DeclarationBlock[]): string[] {
  return blocks.flatMap(({ file, line, selector, tokens }) => SELECTION_PAIRS.flatMap(([bgName, inkName]) => {
    const bg = tokens.get(bgName);
    const ink = tokens.get(inkName);
    const at = `${file}:${String(line)} ${selector}`;
    if (bg === undefined && ink === undefined) return [];
    if (bg === undefined || ink === undefined) return [`${at}: sets ${bg === undefined ? inkName : bgName} without ${bg === undefined ? bgName : inkName}`];
    if ((bg === "initial") !== (ink === "initial")) return [`${at}: resets one of ${bgName} and ${inkName} with initial`];
    const bgColor = hex(bg);
    const inkColor = hex(ink);
    if (bgColor === null || inkColor === null) return [];
    const ratio = contrastRatio(inkColor, bgColor);
    return ratio >= NORMAL ? [] : [`${at}: ${inkName} ${ink} on ${bgName} ${bg} is ${ratio.toFixed(2)}:1 < ${String(NORMAL)}`];
  }));
}
