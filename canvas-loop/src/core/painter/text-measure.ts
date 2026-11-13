// Text measurement without drawing: one small throw-away canvas context, its
// widths cached by font and text. The painter lays out every `v.text` through
// it, and `u.textWidth` / `u.textBounds` use the same one, so `update` and
// `draw` get the same numbers for the same text.
//
// Widths depend on the fonts the runtime has: headless and a browser can differ,
// and a browser web font that loads later changes them (`clear()` on load).
import type { Ctx2D, CtxTransform, MakeLayer, TextBounds, TextBox, TextOptions, TextStyle } from "../paint.js";
import { layoutText } from "./text-layout.js";
import type { TextLayout } from "./text-layout.js";

/** What `text(s, box, options)` uses for options left out. */
export const TEXT_DEFAULTS = { size: 12, font: "sans-serif", style: "normal", fill: "#000000", align: "left", valign: "top" } as const satisfies TextOptions;

/** Text laid out for one call, ready to draw. */
export interface LaidText {
  box: TextBox;
  options: TextOptions & Required<Pick<TextOptions, "size" | "font" | "style" | "fill" | "align" | "valign">>;
  layout: TextLayout | undefined;
  bounds: TextBounds;
}

/** Width of a halo's band around text of `size`. */
export const haloWidth = (size: number): number => Math.max(2, size / 4);

/** The CSS font string for a size, family and style. */
export const fontString = (over: { size: number; font: string; style: TextStyle }): string => `${over.style} ${over.size}px ${over.font}`;

/** Where measured text sits: the current transform (logical → device) and the canvas's logical size. */
export interface TextPlace {
  transform: CtxTransform;
  pixelRatio: number;
  canvas: { width: number; height: number };
}

/** Past this many cached widths the cache starts over, so generated text cannot grow it without bound. */
const CACHE_LIMIT = 10_000;

export class TextMeasurer {
  #makeLayer: MakeLayer;
  #ctx: Ctx2D | undefined;
  #widths = new Map<string, number>();

  constructor(makeLayer: MakeLayer) {
    this.#makeLayer = makeLayer;
  }

  /** The width of `text` in `font` (a CSS font string), in logical pixels. */
  measure(text: string, font: string): number {
    const key = `${font}\n${text}`;
    const cached = this.#widths.get(key);
    if (cached !== undefined) return cached;
    this.#ctx ??= this.#makeLayer({ width: 1, height: 1 }).ctx;
    this.#ctx.font = font;
    const { width } = this.#ctx.measureText(text);
    if (this.#widths.size >= CACHE_LIMIT) this.#widths.clear();
    this.#widths.set(key, width);
    return width;
  }

  /** Forget every width: fonts changed (a web font finished loading). */
  clear(): void {
    this.#widths.clear();
  }

  /** The width `text` would take with these options, in logical pixels. */
  width(content: string, options?: TextOptions): number {
    return this.measure(content, fontString({ ...TEXT_DEFAULTS, ...options }));
  }

  /** Lay text out; with `keepInside`, move it so its bounds stay inside the canvas. */
  place(content: string, at: { box: TextBox; options: TextOptions; where: TextPlace }): LaidText {
    const laid = this.#lay(content, at);
    if (at.options.keepInside !== true) return laid;
    const shift = insideShift(laid.bounds, at.where);
    if (shift === undefined) return laid;
    return this.#lay(content, { ...at, box: { ...at.box, x: at.box.x + shift.x, y: at.box.y + shift.y } });
  }

  /**
   * Lay text out without drawing. One line with no box is placed by the
   * context's own alignment and baseline (`layout` undefined); anything else
   * is laid out line by line.
   */
  #lay(content: string, at: { box: TextBox; options: TextOptions }): LaidText {
    const options = { ...TEXT_DEFAULTS, ...at.options };
    const { box } = at;
    const measure = (text: string, size: number): number => this.measure(text, fontString({ ...options, size }));
    const native = box.w === undefined && box.h === undefined && !content.includes("\n");
    const layout = native ? undefined : layoutText(content, { size: options.size, box, options, measure });
    // A halo widens the ink by half its band on every side.
    const grow = (b: TextBounds): TextBounds => {
      if (options.halo === undefined) return b;
      const pad = haloWidth(b.size) / 2;
      return { ...b, x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    };
    if (layout !== undefined) {
      const bounds = { x: layout.x, y: layout.y, w: layout.w, h: layout.h, lines: layout.lines.length, size: layout.size, overflow: layout.overflow };
      return { box, options, layout, bounds: grow(bounds) };
    }
    const size = options.size;
    const w = measure(content, size);
    const x = options.align === "center" ? box.x - w / 2 : options.align === "right" ? box.x - w : box.x;
    const h = size * 1.25;
    const top = { top: box.y, middle: box.y - h / 2, bottom: box.y - h, baseline: box.y - size }[options.valign];
    return { box, options, layout, bounds: grow({ x, y: top, w, h, lines: 1, size, overflow: false }) };
  }
}

/**
 * The move, in the current coordinates, that brings `b` inside the canvas
 * less a margin. Measured in canvas space, so it holds under `at`. Text
 * larger than the canvas keeps its left/top edge inside. Undefined when no
 * move is needed or the transform cannot be inverted.
 */
function insideShift(b: TextBounds, where: TextPlace): { x: number; y: number } | undefined {
  const MARGIN = 4;
  const m = where.transform;
  const pr = where.pixelRatio;
  const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const;
  const xs = corners.map(([x, y]) => (m.a * x + m.c * y + m.e) / pr);
  const ys = corners.map(([x, y]) => (m.b * x + m.d * y + m.f) / pr);
  const fit = (...[lo, hi, size]: [number, number, number]): number => {
    if (lo < MARGIN || hi - lo > size - 2 * MARGIN) return MARGIN - lo;
    return hi > size - MARGIN ? size - MARGIN - hi : 0;
  };
  const dx = fit(Math.min(...xs), Math.max(...xs), where.canvas.width);
  const dy = fit(Math.min(...ys), Math.max(...ys), where.canvas.height);
  if (dx === 0 && dy === 0) return undefined;
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return undefined;
  // Undo the linear part: canvas-space move (times the pixel ratio) → local move.
  const cx = dx * pr;
  const cy = dy * pr;
  return { x: (m.d * cx - m.c * cy) / det, y: (-m.b * cx + m.a * cy) / det };
}
