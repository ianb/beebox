// The p5-like drawing engine, extracted from Sketch so a single implementation
// serves every harness. It is typed against the structural `Ctx2D` subset (see
// paint.ts), so the same code paints onto the headless Skia context (CLI) and a
// browser `CanvasRenderingContext2D` (the HTML playground) — the two concrete
// contexts are each handed in through one boundary cast by their owner.
//
// Painter owns only drawing: style state, transforms, the shape/text/gradient
// primitives, brushes, groups, and the data→ctx crossing. Randomness, time,
// input, capture, and canvas creation stay with the caller (Sketch for the CLI,
// the browser runtime for the playground), which also supplies `makeLayer` for
// offscreen surfaces.
import { resolveBrush } from "../brush/presets.js";
import type { BrushName } from "../brush/presets.js";
import { PaperSheet } from "../brush/paper.js";
import { renderMark } from "../brush/render/mark.js";
import type { Brush, BrushOverrides, Gesture, Paper } from "../brush/types.js";
import type { Contour } from "../contours.js";
import { curveCommands, ellipseContour, pathContours } from "../contours.js";
import { SketchUsageError } from "../errors.js";
import { initialStyle } from "./style.js";
import type { StyleState } from "./style.js";
import type { BlendMode, ClipShape, Ctx2D, Ctx2DGradient, CtxTextAlign, CtxTextBaseline, Layer, MakeLayer, Paint, PathCommand, Vec2 } from "../paint.js";
import { compositeOp, inPaintSpace, isPathShape, resolveGradient, tracePath, tracePolygon } from "../paint.js";
import { FaintWatch } from "./faint.js";
import { drawLayer, fillShapes, isShapeList, maskLayer } from "./layers.js";
import { paperOverlay } from "../brush/paper.js";

/** Options for `group`: opacity applied once to the finished group, and its blend mode. */
export interface GroupOptions {
  readonly opacity?: number;
  readonly blend?: BlendMode;
}

/**
 * The shared p5-like drawing surface over a structural `Ctx2D`. Drawing is
 * deterministic: colors are CSS strings or plain-data gradient handles, and
 * brush jitter comes from per-mark seeds. The engine mutates the context but
 * holds no time/random/input state.
 */
export class Painter {
  readonly width: number;
  readonly height: number;

  // The bottom entry is the canvas; `group` pushes its layer's context.
  #ctxStack: Ctx2D[];
  #makeLayer: MakeLayer;
  #style: StyleState = initialStyle();
  #styleStack: StyleState[] = [];
  // `pop` may not reach below the depth an open group started at.
  #floor = 0;
  #paper: PaperSheet;
  // Opacity of each open group, so a mark's visible strength can be judged.
  #alphaStack: number[] = [];
  #faint: FaintWatch;

  constructor(options: { ctx: Ctx2D; width: number; height: number; makeLayer: MakeLayer; warn?: (message: string) => void }) {
    this.#ctxStack = [options.ctx];
    this.#paper = new PaperSheet(options.makeLayer, { width: options.width, height: options.height });
    this.#faint = new FaintWatch(options.warn ?? (() => {}));
    this.#makeLayer = options.makeLayer;
    this.width = options.width;
    this.height = options.height;
  }

  /** The context drawing currently lands on: the canvas, or the innermost open group. */
  get ctx(): Ctx2D {
    const top = this.#ctxStack.at(-1);
    if (top === undefined) throw new SketchUsageError({ detail: "no drawing context" });
    return top;
  }

  // ── style ────────────────────────────────────────────────────────
  fill(paint: Paint): void {
    this.#style.fillColor = paint;
    this.#style.fillEnabled = true;
  }
  noFill(): void {
    this.#style.fillEnabled = false;
  }
  stroke(paint: Paint): void {
    this.#style.strokeColor = paint;
    this.#style.strokeEnabled = true;
  }
  noStroke(): void {
    this.#style.strokeEnabled = false;
  }
  strokeWeight(weight: number): void {
    this.#style.strokeW = weight;
  }
  textSize(size: number): void {
    this.#style.textSize = size;
  }
  textAlign(horizontal: CtxTextAlign, vertical?: CtxTextBaseline): void {
    this.#style.textAlignH = horizontal;
    if (vertical !== undefined) this.#style.textAlignV = vertical;
  }

  // ── brushes ──────────────────────────────────────────────────────
  /** Strokes from now on are brushed marks: a preset name (with overrides) or a Brush. */
  brush(base: BrushName | Brush, overrides?: BrushOverrides): void {
    this.#style.brush = resolveBrush(base, overrides);
  }
  /** Back to plain Canvas2D strokes. */
  noBrush(): void {
    this.#style.brush = undefined;
  }
  /** How the hand moves for the marks that follow (pressure, wobble, seed). */
  gesture(gesture: Gesture): void {
    this.#style.gesture = gesture;
  }
  /** Set the canvas's paper texture (grainy brushes read it). */
  paper(paper: Paper): void {
    this.#paper.set(paper);
  }
  blendMode(blend: BlendMode): void {
    this.#style.blend = blend;
  }
  /** Fills, strokes and marks remove pixels instead of adding them, until `noErase()`. */
  erase(): void {
    this.#style.erasing = true;
  }
  noErase(): void {
    this.#style.erasing = false;
  }

  push(): void {
    this.ctx.save();
    this.#styleStack.push({ ...this.#style });
  }
  /** Restore the last pushed state. Returns false on underflow (no matching push in this scope). */
  pop(): boolean {
    if (this.#styleStack.length <= this.#floor) return false;
    const restored = this.#styleStack.pop();
    if (restored === undefined) return false;
    this.ctx.restore();
    this.#style = restored;
    return true;
  }

  // ── transforms ───────────────────────────────────────────────────
  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }
  rotate(radians: number): void {
    this.ctx.rotate(radians);
  }
  scale(x: number, y?: number): void {
    this.ctx.scale(x, y ?? x);
  }

  #resolvePaint(paint: Paint): string | Ctx2DGradient {
    if (typeof paint === "string") return paint;
    return resolveGradient(this.ctx, paint);
  }

  // ── drawing ──────────────────────────────────────────────────────
  background(paint: Paint): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.resetTransform();
    ctx.globalCompositeOperation = "source-over";
    // Resolve after resetTransform so a gradient's coords are canvas-space.
    ctx.fillStyle = this.#resolvePaint(paint);
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    inPaintSpace(ctx, { paint, fill: () => ctx.fill() });
    ctx.restore();
  }

  rect(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    this.#paint(() => [{ points: corners, closed: true }]);
  }

  circle(...args: [number, number, number]): void {
    const [x, y, diameter] = args;
    this.ellipse(x, y, diameter, diameter);
  }

  ellipse(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.#paint(() => [ellipseContour({ x, y, rx: w / 2, ry: h / 2, start: 0, end: Math.PI * 2, step: this.#step() })]);
  }

  line(...args: [number, number, number, number]): void {
    const [x1, y1, x2, y2] = args;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.#strokeShape(() => [{ points: [[x1, y1], [x2, y2]], closed: false }]);
  }

  triangle(...args: [number, number, number, number, number, number]): void {
    const [x1, y1, x2, y2, x3, y3] = args;
    const points: Vec2[] = [[x1, y1], [x2, y2], [x3, y3]];
    tracePolygon(this.ctx, points);
    this.#paint(() => [{ points, closed: true }]);
  }

  arc(...args: [number, number, number, number, number]): void {
    const [x, y, radius, start, end] = args;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, start, end);
    this.#paint(() => [ellipseContour({ x, y, rx: radius, ry: radius, start, end, step: this.#step() })]);
  }

  polygon(points: readonly Vec2[]): void {
    tracePolygon(this.ctx, points);
    this.#paint(() => [{ points, closed: true }]);
  }

  path(commands: readonly PathCommand[]): void {
    tracePath(this.ctx, commands);
    this.#paint(() => pathContours(commands, this.#step()));
  }

  /** A smooth curve through every point (Catmull-Rom, like p5's curveVertex). */
  curve(points: readonly Vec2[], closed?: boolean): void {
    this.path(curveCommands(points, closed ?? false));
  }

  /** Darken the paper's valleys across everything drawn so far, so flat colour looks printed on paper. */
  paperTexture(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0 || amount > 1) {
      throw new SketchUsageError({ detail: `paperTexture amount must be a number in 0..1, got ${amount}` });
    }
    paperOverlay(this.ctx, { paper: this.#paper.layer(), amount, width: this.width, height: this.height });
  }

  // Clip to a polygon/path (or the union of several) for the duration of `body`, restoring afterward.
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    if (isShapeList(shape)) {
      const m = this.ctx.getTransform();
      const layer = this.#onLayer(body, 1);
      const mask = this.#makeLayer({ width: this.width, height: this.height });
      mask.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      fillShapes(mask.ctx, shape);
      maskLayer(layer, { mask, width: this.width, height: this.height });
      drawLayer(this.ctx, { image: layer.image, width: this.width, height: this.height, opacity: 1, op: "source-over" });
      return;
    }
    const depth = this.#styleStack.length;
    this.push();
    try {
      const ctx = this.ctx;
      if (isPathShape(shape)) tracePath(ctx, shape);
      else tracePolygon(ctx, shape);
      ctx.clip();
      body();
    } finally {
      while (this.#styleStack.length > depth && this.pop());
    }
  }

  /**
   * Draw `body` on its own layer, then composite the finished layer once with
   * `opacity` and `blend`. Overlapping opaque children do not darken; erasing
   * inside the group removes only the group's own pixels.
   */
  group(options: GroupOptions, body: () => void): void {
    const opacity = options.opacity ?? 1;
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new SketchUsageError({ detail: `group opacity must be a number in 0..1, got ${opacity}` });
    }
    const layer = this.#onLayer(body, opacity);
    const op = compositeOp(options.blend ?? "normal");
    drawLayer(this.ctx, { image: layer.image, width: this.width, height: this.height, opacity, op });
  }

  /** Run `body` drawing onto a fresh full-canvas layer; state changes inside do not leak out. */
  #onLayer(body: () => void, opacity: number): Layer {
    const m = this.ctx.getTransform();
    const layer = this.#makeLayer({ width: this.width, height: this.height });
    layer.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const savedFloor = this.#floor;
    const savedStyle = { ...this.#style };
    const depth = this.#styleStack.length;
    this.#floor = depth;
    this.#ctxStack.push(layer.ctx);
    this.#alphaStack.push(opacity);
    try {
      body();
    } finally {
      while (this.#styleStack.length > depth && this.pop());
      this.#ctxStack.pop();
      this.#alphaStack.pop();
      this.#floor = savedFloor;
      this.#style = savedStyle;
    }
    return layer;
  }


  text(...args: [string, number, number]): void {
    const [content, x, y] = args;
    const ctx = this.ctx;
    ctx.font = `${this.#style.textSize}px sans-serif`;
    ctx.textAlign = this.#style.textAlignH;
    ctx.textBaseline = this.#style.textAlignV;
    if (this.#style.fillEnabled) {
      ctx.fillStyle = this.#resolvePaint(this.#style.fillColor);
      this.#withComposite(this.#composite(), () => ctx.fillText(content, x, y));
    }
  }

  /** Flattening step in user units: half a device pixel under the current transform. */
  #step(): number {
    const m = this.ctx.getTransform();
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    return scale > 0 ? 0.5 / scale : 0.5;
  }

  #composite(): string {
    return this.#style.erasing ? "destination-out" : compositeOp(this.#style.blend);
  }

  #withComposite(op: string, draw: () => void): void {
    const ctx = this.ctx;
    const previous = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = op;
    draw();
    ctx.globalCompositeOperation = previous;
  }

  #paint(contours: () => Contour[]): void {
    if (this.#style.fillEnabled) {
      const ctx = this.ctx;
      const paint = this.#style.fillColor;
      ctx.fillStyle = this.#resolvePaint(paint);
      this.#withComposite(this.#composite(), () => inPaintSpace(ctx, { paint, fill: () => ctx.fill() }));
    }
    this.#strokeShape(contours);
  }

  #strokeShape(contours: () => Contour[]): void {
    if (!this.#style.strokeEnabled) return;
    const brush = this.#style.brush;
    if (brush === undefined) {
      const ctx = this.ctx;
      ctx.strokeStyle = this.#resolvePaint(this.#style.strokeColor);
      ctx.lineWidth = this.#style.strokeW;
      this.#withComposite(this.#composite(), () => ctx.stroke());
      return;
    }
    const { erasing, blend } = this.#style;
    const composite = erasing ? "destination-out" : compositeOp(blend === "normal" ? (brush.blend ?? "normal") : blend);
    const peak = renderMark({
      target: this.ctx,
      makeLayer: this.#makeLayer,
      canvas: { width: this.width, height: this.height },
      contours: contours(),
      paint: this.#style.strokeColor,
      weight: this.#style.strokeW,
      brush,
      gesture: this.#style.gesture,
      paper: () => this.#paper.layer(),
      composite,
    });
    if (peak !== undefined && !erasing) this.#faint.check(peak, this.#alphaStack);
  }
}
