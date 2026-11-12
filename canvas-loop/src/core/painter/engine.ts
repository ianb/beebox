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
import type { Ctx2D, Paint, PathCommand, Vec2 } from "../paint.js";
import { inPaintSpace, tracePath, tracePolygon } from "../paint.js";
import { PainterCore } from "./core.js";
import { withComposite } from "./layers.js";

/**
 * The shared p5-like drawing surface over a structural `Ctx2D`. Drawing is
 * deterministic: colors are CSS strings or plain-data gradient handles, and
 * brush jitter comes from per-mark seeds. The engine mutates the context but
 * holds no time/random/input state.
 */
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

  rect(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
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

  text(...args: [string, number, number]): void {
    const [content, x, y] = args;
    const ctx = this.ctx;
    ctx.font = `${this.style.textStyle} ${this.style.textSize}px ${this.style.textFont}`;
    ctx.textAlign = this.style.textAlignH;
    ctx.textBaseline = this.style.textAlignV;
    if (this.style.fillEnabled) {
      ctx.fillStyle = this.resolvePaint(this.style.fillColor);
      withComposite(ctx, { op: this.composite(), draw: () => ctx.fillText(content, x, y) });
    }
  }

  /** A fillable shape: fill (when enabled) and stroke what `trace` lays down. */
  #closed(trace: (ctx: Ctx2D) => void, contours: () => Contour[]): void {
    this.paintShape(trace, { contours, fill: true });
  }
}
