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
import type { Ctx2D, Paint, PathCommand, Style, TextBounds, TextBox, TextOptions, Vec2 } from "../paint.js";
import { resolveStyle } from "./style.js";
import { inPaintSpace, tracePath, tracePolygon, withSaved } from "../paint.js";
import { PainterCore } from "./core.js";
import { fontString, haloWidth, TextMeasurer } from "./text-measure.js";
import type { LaidText } from "./text-measure.js";

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

const BASELINES = { top: "top", middle: "middle", bottom: "bottom", baseline: "alphabetic" } as const;

export class Painter extends PainterCore {
  /** Measures text for layout here and for `u.textWidth` / `u.textBounds` in `update`. */
  readonly measurer: TextMeasurer;

  constructor(options: ConstructorParameters<typeof PainterCore>[0]) {
    super(options);
    this.measurer = new TextMeasurer(options.makeLayer);
  }

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
    return this.measurer.width(content, options);
  }

  /** `textBounds` as text drawn with no `v.at` transform would have them: what `update` measures. */
  plainTextBounds(...args: [string, TextBox, TextOptions?]): TextBounds {
    const [content, box, options] = args;
    const pr = this.pixelRatio;
    const where = { transform: { a: pr, b: 0, c: 0, d: pr, e: 0, f: 0 }, pixelRatio: pr, canvas: { width: this.width, height: this.height } };
    return this.measurer.place(content, { box, options: options ?? {}, where }).bounds;
  }

  /** Lay text out where it will be drawn: under the current transform, inside this canvas. */
  #placeText(content: string, at: { box: TextBox; options: TextOptions }): LaidText {
    const where = { transform: this.ctx.getTransform(), pixelRatio: this.pixelRatio, canvas: { width: this.width, height: this.height } };
    return this.measurer.place(content, { ...at, where });
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
        ctx.font = fontString({ ...options, size });
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


  /** A fillable shape: fill and stroke what `trace` lays down. */
  #closed(trace: (ctx: Ctx2D) => void, shape: { contours: () => Contour[]; style: Style; call: string }): void {
    this.paintShape(trace, { contours: shape.contours, fill: true, style: resolveStyle(shape.style, shape.call), call: shape.call });
  }
}
