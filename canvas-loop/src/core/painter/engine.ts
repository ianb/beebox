// The drawing engine: a single implementation serves every harness. It is typed against the structural `Ctx2D` subset (see
// paint.ts), so the same code paints onto the headless Skia context (CLI) and a
// browser `CanvasRenderingContext2D` (the HTML playground) — the two concrete
// contexts are each handed in through one boundary cast by their owner.
//
// This file holds the shape primitives; `core.ts` holds the context stack,
// layers, groups, clips, caches, sprites and brushed strokes they paint
// through, and `style.ts` the style state.
import type { Contour } from "../contours.js";
import { curveCommands, ellipseContour, pathContours } from "../contours.js";
import type { Ctx2D, Paint, PathCommand, Style, TextBounds, TextBox, TextOptions, TextStyle, Vec2 } from "../paint.js";
import { resolveStyle } from "./style.js";
import { inPaintSpace, tracePath, tracePolygon, withSaved } from "../paint.js";
import { PainterCore } from "./core.js";
import { layoutText } from "./text-layout.js";
import type { TextLayout } from "./text-layout.js";

/**
 * The shared drawing surface over a structural `Ctx2D`. Drawing is
 * deterministic: colors are CSS strings or plain-data gradient handles, and
 * brush jitter comes from per-mark seeds. The engine mutates the context but
 * holds no time/random/input state.
 */
/** A rounded rectangle as path commands (corner arcs as quadratic curves). */
function roundedRect(b: { x: number; y: number; w: number; h: number; r: number }): PathCommand[] {
  const { x, y, w, h, r } = b;
  return [
    ["move", x + r, y],
    ["line", x + w - r, y],
    ["quad", x + w, y, x + w, y + r],
    ["line", x + w, y + h - r],
    ["quad", x + w, y + h, x + w - r, y + h],
    ["line", x + r, y + h],
    ["quad", x, y + h, x, y + h - r],
    ["line", x, y + r],
    ["quad", x, y, x + r, y],
    ["close"],
  ];
}

/** What `text(s, box, options)` uses for options left out. */
const TEXT_DEFAULTS = { size: 12, font: "sans-serif", style: "normal", fill: "#000000", align: "left", valign: "top" } as const satisfies TextOptions;

/** Text laid out for one call, ready to draw. */
interface LaidText {
  box: TextBox;
  options: TextOptions & Required<Pick<TextOptions, "size" | "font" | "style" | "fill" | "align" | "valign">>;
  layout: TextLayout | undefined;
  bounds: TextBounds;
}

/** Width of a halo's band around text of `size`. */
const haloWidth = (size: number): number => Math.max(2, size / 4);

const BASELINES = { top: "top", middle: "middle", bottom: "bottom", baseline: "alphabetic" } as const;

export class Painter extends PainterCore {
  background(paint: Paint): void {
    const ctx = this.ctx;
    withSaved(ctx, () => {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      // Resolve after the reset so a gradient's coords are canvas-space.
      ctx.fillStyle = this.resolvePaint(paint);
      ctx.beginPath();
      ctx.rect(0, 0, this.width, this.height);
      inPaintSpace(ctx, { paint, fill: () => ctx.fill() });
    });
  }

  rect(...args: [number, number, number, number, Style]): void {
    const [x, y, w, h, style] = args;
    const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }, { contours: () => [{ points: corners, closed: true }], style, call: "rect" });
  }

  /** A rectangle with corners rounded to `radius`. */
  roundRect(...args: [number, number, number, number, number, Style]): void {
    const [x, y, w, h, radius, style] = args;
    const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
    const commands = roundedRect({ x, y, w, h, r });
    this.#closed((ctx) => tracePath(ctx, commands), { contours: () => pathContours(commands, this.step()), style, call: "roundRect" });
  }

  circle(...args: [number, number, number, Style]): void {
    const [x, y, radius, style] = args;
    this.ellipse(x, y, radius, radius, style);
  }

  ellipse(...args: [number, number, number, number, Style]): void {
    const [x, y, rx, ry, style] = args;
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    }, { contours: () => [ellipseContour({ x, y, rx, ry, start: 0, end: Math.PI * 2, step: this.step() })], style, call: "ellipse" });
  }

  line(...args: [number, number, number, number, Style]): void {
    const [x1, y1, x2, y2, style] = args;
    const trace = (ctx: Ctx2D): void => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    };
    this.paintShape(trace, { contours: () => [{ points: [[x1, y1], [x2, y2]], closed: false }], fill: false, style: resolveStyle(style, "line"), call: "line" });
  }

  triangle(...args: [number, number, number, number, number, number, Style]): void {
    const [x1, y1, x2, y2, x3, y3, style] = args;
    const points: Vec2[] = [[x1, y1], [x2, y2], [x3, y3]];
    this.#closed((ctx) => tracePolygon(ctx, points), { contours: () => [{ points, closed: true }], style, call: "triangle" });
  }

  arc(...args: [number, number, number, number, number, Style]): void {
    const [x, y, radius, start, end, style] = args;
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, start, end);
    }, { contours: () => [ellipseContour({ x, y, rx: radius, ry: radius, start, end, step: this.step() })], style, call: "arc" });
  }

  polygon(points: readonly Vec2[], style: Style): void {
    this.#closed((ctx) => tracePolygon(ctx, points), { contours: () => [{ points, closed: true }], style, call: "polygon" });
  }

  path(commands: readonly PathCommand[], style: Style): void {
    this.#closed((ctx) => tracePath(ctx, commands), { contours: () => pathContours(commands, this.step()), style, call: "path" });
  }

  /** A smooth curve through every point (Catmull-Rom, like p5's curveVertex). */
  curve(...args: [readonly Vec2[], boolean, Style]): void {
    const [points, closed, style] = args;
    this.path(curveCommands(points, closed), style);
  }

  /**
   * Write text at a point or in a box. Options left out take the defaults
   * (size 12, sans-serif, black, left, top), never earlier calls' settings.
   * Returns the bounds drawn.
   */
  text(...args: [string, TextBox, TextOptions?]): TextBounds {
    const [content, box, options] = args;
    const laid = this.#placeText(content, { box, options: options ?? {} });
    this.#drawText(content, laid);
    const resolved = laid.options;
    if (!(resolved.erase ?? false)) this.recordText(content, laid.bounds);
    this.checkGlyphs(content, { style: resolved.style, family: resolved.font });
    return laid.bounds;
  }

  /** The bounds `text` would draw with these arguments, without drawing. */
  textBounds(...args: [string, TextBox, TextOptions?]): TextBounds {
    const [content, box, options] = args;
    return this.#placeText(content, { box, options: options ?? {} }).bounds;
  }

  /** The width `text` would take with these options, in logical pixels. */
  textWidth(content: string, options?: TextOptions): number {
    const ctx = this.ctx;
    const previous = ctx.font;
    ctx.font = this.#font({ ...TEXT_DEFAULTS, ...options });
    const { width } = ctx.measureText(content);
    ctx.font = previous;
    return width;
  }

  /** Lay text out; with `keepInside`, move it so its bounds stay inside the canvas. */
  #placeText(content: string, at: { box: TextBox; options: TextOptions }): LaidText {
    const laid = this.#layText(content, at);
    if (at.options.keepInside !== true) return laid;
    const shift = this.#insideShift(laid.bounds);
    if (shift === undefined) return laid;
    return this.#layText(content, { ...at, box: { ...at.box, x: at.box.x + shift.x, y: at.box.y + shift.y } });
  }

  /**
   * The move, in the current coordinates, that brings `b` inside the canvas
   * less a margin. Measured in canvas space, so it holds under `at`. Text
   * larger than the canvas keeps its left/top edge inside. Undefined when no
   * move is needed or the transform cannot be inverted.
   */
  #insideShift(b: TextBounds): { x: number; y: number } | undefined {
    const MARGIN = 4;
    const m = this.ctx.getTransform();
    const pr = this.pixelRatio;
    const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]] as const;
    const xs = corners.map(([x, y]) => (m.a * x + m.c * y + m.e) / pr);
    const ys = corners.map(([x, y]) => (m.b * x + m.d * y + m.f) / pr);
    const fit = (...[lo, hi, size]: [number, number, number]): number => {
      if (lo < MARGIN || hi - lo > size - 2 * MARGIN) return MARGIN - lo;
      return hi > size - MARGIN ? size - MARGIN - hi : 0;
    };
    const dx = fit(Math.min(...xs), Math.max(...xs), this.width);
    const dy = fit(Math.min(...ys), Math.max(...ys), this.height);
    if (dx === 0 && dy === 0) return undefined;
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) < 1e-12) return undefined;
    // Undo the linear part: canvas-space move (times the pixel ratio) → local move.
    const cx = dx * pr;
    const cy = dy * pr;
    return { x: (m.d * cx - m.c * cy) / det, y: (-m.b * cx + m.a * cy) / det };
  }

  /**
   * Lay text out without drawing. One line with no box is placed by the
   * context's own alignment and baseline (`layout` undefined); anything else
   * is laid out line by line.
   */
  #layText(content: string, at: { box: TextBox; options: TextOptions }): LaidText {
    const options = { ...TEXT_DEFAULTS, ...at.options };
    const { box } = at;
    const measureCtx = this.ctx;
    const measure = (text: string, size: number): number => withSaved(measureCtx, () => {
      measureCtx.font = this.#font({ ...options, size });
      return measureCtx.measureText(text).width;
    });
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

  #drawText(content: string, laid: LaidText): void {
    const { box, options, layout } = laid;
    const size = laid.bounds.size;
    const lineHeight = size * (options.lineHeight ?? 1.25);
    const mode = { blend: options.blend ?? "normal", erase: options.erase ?? false } as const;
    // Draws on whichever context is current: the canvas, or an erase layer.
    const draw = (op: string): void => {
      const ctx = this.ctx;
      withSaved(ctx, () => {
        ctx.font = this.#font({ ...options, size });
        ctx.fillStyle = this.resolvePaint(options.fill);
        ctx.globalCompositeOperation = op;
        const halo = options.halo;
        if (halo !== undefined) {
          ctx.strokeStyle = this.resolvePaint(halo);
          ctx.lineWidth = haloWidth(size);
          ctx.lineJoin = "round";
        }
        const write = (...[text, x, y]: [string, number, number]): void => {
          if (halo !== undefined) ctx.strokeText(text, x, y);
          ctx.fillText(text, x, y);
        };
        if (layout === undefined) {
          ctx.textAlign = options.align;
          ctx.textBaseline = BASELINES[options.valign];
          write(content, box.x, box.y);
          return;
        }
        ctx.textAlign = "left";
        const baseline = options.valign === "baseline";
        ctx.textBaseline = baseline ? "alphabetic" : "middle";
        for (const [index, line] of layout.lines.entries()) write(line.text, line.x, baseline ? box.y + index * lineHeight : line.y);
      });
    };
    this.drawComposited(mode, draw);
  }

  #font(over: { size: number; font: string; style: TextStyle }): string {
    return `${over.style} ${over.size}px ${over.font}`;
  }

  /** A fillable shape: fill and stroke what `trace` lays down. */
  #closed(trace: (ctx: Ctx2D) => void, shape: { contours: () => Contour[]; style: Style; call: string }): void {
    this.paintShape(trace, { contours: shape.contours, fill: true, style: resolveStyle(shape.style, shape.call), call: shape.call });
  }
}
