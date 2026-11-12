// The p5-like drawing engine, extracted from Sketch so a single implementation
// serves every harness. It is typed against the structural `Ctx2D` subset (see
// paint.ts), so the same code paints onto the headless Skia context (CLI) and a
// browser `CanvasRenderingContext2D` (the HTML playground) — the two concrete
// contexts are each handed in through one boundary cast by their owner.
//
// This file holds the shape primitives; `core.ts` holds the context stack,
// layers, groups, clips, caches, sprites and brushed strokes they paint
// through, and `style.ts` the style state.
import type { Contour } from "../contours.js";
import { curveCommands, ellipseContour, pathContours } from "../contours.js";
import type { Ctx2D, Paint, PathCommand, TextArgs, TextBounds, TextBox, TextOptions, TextStyle, Vec2 } from "../paint.js";
import { inPaintSpace, tracePath, tracePolygon } from "../paint.js";
import { PainterCore } from "./core.js";
import { withComposite } from "./layers.js";
import { layoutText } from "./text-layout.js";

/**
 * The shared p5-like drawing surface over a structural `Ctx2D`. Drawing is
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

export class Painter extends PainterCore {
  background(paint: Paint): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    // Resolve after the reset so a gradient's coords are canvas-space.
    ctx.fillStyle = this.resolvePaint(paint);
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    inPaintSpace(ctx, { paint, fill: () => ctx.fill() });
    ctx.restore();
  }

  /** A rectangle; with a fifth argument, its corners are rounded to that radius (as p5's `rect`). */
  rect(...args: [number, number, number, number, number?]): void {
    const [x, y, w, h, radius] = args;
    if (radius !== undefined && radius > 0) {
      this.path(roundedRect({ x, y, w, h, r: Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2) }));
      return;
    }
    const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }, () => [{ points: corners, closed: true }]);
  }

  circle(...args: [number, number, number]): void {
    const [x, y, diameter] = args;
    this.ellipse(x, y, diameter, diameter);
  }

  ellipse(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    }, () => [ellipseContour({ x, y, rx: w / 2, ry: h / 2, start: 0, end: Math.PI * 2, step: this.step() })]);
  }

  line(...args: [number, number, number, number]): void {
    const [x1, y1, x2, y2] = args;
    const trace = (ctx: Ctx2D): void => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    };
    this.paintShape(trace, { contours: () => [{ points: [[x1, y1], [x2, y2]], closed: false }], fill: false });
  }

  triangle(...args: [number, number, number, number, number, number]): void {
    const [x1, y1, x2, y2, x3, y3] = args;
    const points: Vec2[] = [[x1, y1], [x2, y2], [x3, y3]];
    this.#closed((ctx) => tracePolygon(ctx, points), () => [{ points, closed: true }]);
  }

  arc(...args: [number, number, number, number, number]): void {
    const [x, y, radius, start, end] = args;
    this.#closed((ctx) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, start, end);
    }, () => [ellipseContour({ x, y, rx: radius, ry: radius, start, end, step: this.step() })]);
  }

  polygon(points: readonly Vec2[]): void {
    this.#closed((ctx) => tracePolygon(ctx, points), () => [{ points, closed: true }]);
  }

  path(commands: readonly PathCommand[]): void {
    this.#closed((ctx) => tracePath(ctx, commands), () => pathContours(commands, this.step()));
  }

  /** A smooth curve through every point (Catmull-Rom, like p5's curveVertex). */
  curve(points: readonly Vec2[], closed?: boolean): void {
    this.path(curveCommands(points, closed ?? false));
  }

  /**
   * Write text. `text(s, x, y)` draws at a point with the current alignment.
   * `text(s, box, options)` lays out in a box (wrap, align, valign, fit) with
   * per-call style that leaves the current settings alone. Both return the
   * bounds drawn.
   */
  text(...args: TextArgs): TextBounds {
    const [content, at, more] = args;
    if (typeof at === "number") return this.#pointText(content, { x: at, y: typeof more === "number" ? more : 0 });
    return this.#boxText(content, { box: at, options: typeof more === "object" ? more : {} });
  }

  /** The width `text` would take in the current text size, font and style, in logical pixels. */
  textWidth(content: string): number {
    const ctx = this.ctx;
    const previous = ctx.font;
    ctx.font = this.#font({});
    const { width } = ctx.measureText(content);
    ctx.font = previous;
    return width;
  }

  #pointText(content: string, at: { x: number; y: number }): TextBounds {
    const ctx = this.ctx;
    ctx.font = this.#font({});
    ctx.textAlign = this.style.textAlignH;
    ctx.textBaseline = this.style.textAlignV;
    if (this.style.fillEnabled) {
      ctx.fillStyle = this.resolvePaint(this.style.fillColor);
      withComposite(ctx, { op: this.composite(), draw: () => ctx.fillText(content, at.x, at.y) });
    }
    const size = this.style.textSize;
    const w = ctx.measureText(content).width;
    const align = this.style.textAlignH;
    const x = align === "center" ? at.x - w / 2 : align === "right" || align === "end" ? at.x - w : at.x;
    return { x, y: at.y - size, w, h: size * 1.25, lines: 1, size, overflow: false };
  }

  #boxText(content: string, at: { box: TextBox; options: TextOptions }): TextBounds {
    const { options } = at;
    const ctx = this.ctx;
    const previous = { font: ctx.font, align: ctx.textAlign, baseline: ctx.textBaseline };
    const measure = (text: string, size: number): number => {
      ctx.font = this.#font({ ...options, size });
      return ctx.measureText(text).width;
    };
    const layout = layoutText(content, { size: options.size ?? this.style.textSize, box: at.box, options, measure });
    const fill = options.fill ?? (this.style.fillEnabled ? this.style.fillColor : undefined);
    if (fill !== undefined) {
      ctx.font = this.#font({ ...options, size: layout.size });
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = this.resolvePaint(fill);
      withComposite(ctx, {
        op: this.composite(),
        draw: () => {
          for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y);
        },
      });
    }
    ctx.font = previous.font;
    ctx.textAlign = previous.align;
    ctx.textBaseline = previous.baseline;
    return { x: layout.x, y: layout.y, w: layout.w, h: layout.h, lines: layout.lines.length, size: layout.size, overflow: layout.overflow };
  }

  #font(over: { size?: number; font?: string; style?: TextStyle }): string {
    return `${over.style ?? this.style.textStyle} ${over.size ?? this.style.textSize}px ${over.font ?? this.style.textFont}`;
  }

  /** A fillable shape: fill (when enabled) and stroke what `trace` lays down. */
  #closed(trace: (ctx: Ctx2D) => void, contours: () => Contour[]): void {
    this.paintShape(trace, { contours, fill: true });
  }
}
