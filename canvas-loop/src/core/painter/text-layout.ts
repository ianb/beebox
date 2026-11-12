// Lay text out in a box: explicit line breaks, greedy word wrap, alignment, and
// shrink-to-fit. Pure over a `measure` function, so the engine supplies the
// context's measureText and tests can supply a fake.
import type { TextBox, TextOptions } from "../paint.js";

const LINE_HEIGHT = 1.25;
const MIN_FIT_SIZE = 4;

export interface TextLine {
  text: string;
  /** Left edge of the line, after alignment. */
  x: number;
  /** Vertical centre of the line (draw with baseline "middle"). */
  y: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the text does not fit the box's width or height at the final size. */
  overflow: boolean;
}

/** Measure `text` at font size `size`. */
export type Measure = (text: string, size: number) => number;

function wrapParagraph(paragraph: string, fit: { width: number; measure: (text: string) => number }): string[] {
  const words = paragraph.split(/ +/u).filter((word) => word.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && fit.measure(candidate) > fit.width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function breakLines(content: string, at: { size: number; width: number | undefined; measure: Measure }): string[] {
  const paragraphs = content.split("\n");
  const { width } = at;
  if (width === undefined) return paragraphs;
  return paragraphs.flatMap((paragraph) =>
    wrapParagraph(paragraph, { width, measure: (text) => at.measure(text, at.size) }),
  );
}

interface Trial {
  rows: string[];
  widths: number[];
  height: number;
  fits: boolean;
}

function trial(content: string, at: { size: number; box: TextBox; options: TextOptions; measure: Measure }): Trial {
  const wrap = at.options.wrap ?? at.box.w !== undefined;
  const rows = breakLines(content, { size: at.size, width: wrap ? at.box.w : undefined, measure: at.measure });
  const widths = rows.map((row) => at.measure(row, at.size));
  const height = rows.length * at.size * (at.options.lineHeight ?? LINE_HEIGHT);
  const boxW = at.box.w;
  const fitsW = boxW === undefined || widths.every((width) => width <= boxW + 0.01);
  const fitsH = at.box.h === undefined || height <= at.box.h + 0.01;
  return { rows, widths, height, fits: fitsW && fitsH };
}

/** The size `fit` settles on: the largest (to 1/4 px) at or below `size` that fits, else the floor. */
function fitSize(content: string, at: { size: number; box: TextBox; options: TextOptions; measure: Measure }): number {
  if (trial(content, at).fits) return at.size;
  let lo = MIN_FIT_SIZE;
  let hi = at.size;
  while (hi - lo > 0.25) {
    const mid = (lo + hi) / 2;
    if (trial(content, { ...at, size: mid }).fits) lo = mid;
    else hi = mid;
  }
  return lo;
}

function startX(box: TextBox, align: TextOptions["align"]): (width: number) => number {
  if (align === "center") return (width) => (box.w === undefined ? box.x : box.x + box.w / 2) - width / 2;
  if (align === "right") return (width) => (box.w === undefined ? box.x : box.x + box.w) - width;
  return () => box.x;
}

function startY(box: TextBox, at: { valign: TextOptions["valign"]; height: number; size: number; lineHeight: number }): number {
  // "baseline": the first line's baseline at y; lines are drawn on their middles, about 0.35 em above the baseline.
  if (at.valign === "baseline") return box.y - 0.35 * at.size - at.lineHeight / 2;
  if (at.valign === "middle") return (box.h === undefined ? box.y : box.y + box.h / 2) - at.height / 2;
  if (at.valign === "bottom") return (box.h === undefined ? box.y : box.y + box.h) - at.height;
  return box.y;
}

/**
 * Lay `content` out in `box` at font size `size`. Without `w`, `align` places
 * the text about `x`; without `h`, `valign` places it about `y`. So
 * `{x, y}` with `align:"center", valign:"middle"` centres text on a point, and
 * `{x, y, w, h}` writes into a box.
 */
export function layoutText(content: string, at: { size: number; box: TextBox; options: TextOptions; measure: Measure }): TextLayout {
  const size = at.options.fit === true ? fitSize(content, at) : at.size;
  const { rows, widths, height, fits } = trial(content, { ...at, size });
  const lineHeight = size * (at.options.lineHeight ?? LINE_HEIGHT);
  const left = startX(at.box, at.options.align);
  const top = startY(at.box, { valign: at.options.valign, height, size, lineHeight });
  const lines = rows.map((text, index) => {
    const width = widths[index] ?? 0;
    return { text, x: left(width), y: top + (index + 0.5) * lineHeight, width };
  });
  const x = Math.min(...lines.map((line) => line.x));
  const w = Math.max(...widths);
  return { lines, size, x, y: top, w, h: height, overflow: !fits };
}
