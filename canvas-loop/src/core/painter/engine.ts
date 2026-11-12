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
import { PaperSheet } from "../brush/paper.js";
import { renderMark } from "../brush/render/mark.js";
import type { Paper } from "../brush/types.js";
import type { Contour } from "../contours.js";
import { curveCommands, ellipseContour, pathContours } from "../contours.js";
import { SketchUsageError, assertUnit } from "../errors.js";
import { StyledPainter } from "./style.js";
import type { StyleState } from "./style.js";
import type { BlendMode, ClipShape, Ctx2D, Ctx2DGradient, CtxImageData, Layer, MakeLayer, Paint, PathCommand, Sprite, Vec2 } from "../paint.js";
import { compositeOp, inPaintSpace, isPathShape, resolveGradient, tracePath, tracePolygon } from "../paint.js";
import { FaintWatch } from "./faint.js";
import { LayerCache, LayerPool, drawLayer, isShapeList, replaceInShapes, withComposite } from "./layers.js";
import { paperOverlay } from "../brush/paper.js";

/** What `sprite` stores: a key naming everything the picture depends on, and its size in pixels. */
export interface SpriteOptions {
  readonly key: string;
  readonly width: number;
  readonly height: number;
}

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
export class Painter extends StyledPainter {
  readonly width: number;
  readonly height: number;

  // The bottom entry is the canvas; `group` pushes its layer's context.
  #ctxStack: Ctx2D[];
  #makeLayer: MakeLayer;
  #styleStack: StyleState[] = [];
  // `pop` may not reach below the depth an open group started at.
  #floor = 0;
  #paper: PaperSheet;
  // Opacity of each open group, so a mark's visible strength can be judged.
  #alphaStack: number[] = [];
  #faint: FaintWatch;
  // Full-canvas caches are big, sprites small: keep the 24 most recent caches and 400 sprites.
  #cache = new LayerCache(24);
  #sprites = new LayerCache(400);
  #pool: LayerPool;
  // Faint-mark checks read pixels back; only done when someone listens for warnings.
  #measure: boolean;

  constructor(options: { ctx: Ctx2D; width: number; height: number; makeLayer: MakeLayer; warn?: (message: string) => void }) {
    super();
    this.#ctxStack = [options.ctx];
    this.#paper = new PaperSheet(options.makeLayer, { width: options.width, height: options.height });
    this.#faint = new FaintWatch(options.warn ?? (() => {}));
    this.#measure = options.warn !== undefined;
    this.#pool = new LayerPool(options.makeLayer, { width: options.width, height: options.height });
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

  /** Set the canvas's paper texture (grainy brushes read it). */
  paper(paper: Paper): void {
    this.#paper.set(paper);
  }

  push(): void {
    this.ctx.save();
    this.#styleStack.push({ ...this.style });
  }
  /** Restore the last pushed state. Returns false on underflow (no matching push in this scope). */
  pop(): boolean {
    if (this.#styleStack.length <= this.#floor) return false;
    const restored = this.#styleStack.pop();
    if (restored === undefined) return false;
    this.ctx.restore();
    this.style = restored;
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
    assertUnit(amount, "paperTexture amount");
    paperOverlay(this.ctx, { paper: this.#paper.layer(), amount, width: this.width, height: this.height });
  }

  // Clip to a polygon/path (or the union of several) for the duration of `body`, restoring afterward.
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    if (isShapeList(shape)) {
      this.#clipUnion(shape, body);
      return;
    }
    const depth = this.#styleStack.length;
    const savedFloor = this.#floor;
    this.push();
    // The body may not pop the clip's own save.
    this.#floor = depth + 1;
    try {
      const ctx = this.ctx;
      if (isPathShape(shape)) tracePath(ctx, shape);
      else tracePolygon(ctx, shape);
      ctx.clip();
      body();
    } finally {
      this.#floor = depth;
      while (this.#styleStack.length > depth && this.pop());
      this.#floor = savedFloor;
    }
  }

  /**
   * Clip to the union of several shapes. The body draws on a copy of what is
   * already there (so erase and blend modes act on it as with a single-shape
   * clip); the union region of the parent is then replaced by the result.
   */
  #clipUnion(shapes: readonly ClipShape[], body: () => void): void {
    const parent = this.ctx;
    const transform = parent.getTransform();
    const before = parent.getImageData(0, 0, this.width, this.height);
    const layer = this.#onLayer(body, { opacity: 1, start: before });
    // `layer` and `scratch` take putImageData, so they are never pooled: @napi-rs/canvas reads such a
    // canvas lazily when it is drawn, and clearing it for reuse would blank what was drawn from it.
    const scratch = this.#makeLayer({ width: this.width, height: this.height });
    this.#pool.borrow((mask) => replaceInShapes(parent, { layer, mask, scratch, before, shapes, transform, width: this.width, height: this.height }));
  }

  /**
   * Draw `body` on its own layer, then composite the finished layer once with
   * `opacity` and `blend`. Overlapping opaque children do not darken; erasing
   * inside the group removes only the group's own pixels.
   */
  group(options: GroupOptions, body: () => void): void {
    const opacity = options.opacity ?? 1;
    assertUnit(opacity, "group opacity");
    const layer = this.#onLayer(body, { opacity });
    const op = compositeOp(options.blend ?? "normal");
    drawLayer(this.ctx, { image: layer.image, width: this.width, height: this.height, opacity, op });
    this.#pool.release(layer);
  }

  /** Run `body` drawing onto a fresh full-canvas layer; state changes inside do not leak out. */
  #onLayer(body: () => void, options: { opacity: number; start?: CtxImageData; keep?: boolean; into?: Layer }): Layer {
    const { opacity, start } = options;
    // A sprite draws into its own layer in local coordinates; a cache keeps its layer for good;
    // the rest come from the pool and go back after use.
    const m = options.into === undefined ? this.ctx.getTransform() : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const fresh = options.keep === true || start !== undefined;
    const layer = options.into ?? (fresh ? this.#makeLayer({ width: this.width, height: this.height }) : this.#pool.acquire());
    if (start !== undefined) layer.ctx.putImageData(start, 0, 0);
    layer.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const savedFloor = this.#floor;
    const savedStyle = { ...this.style };
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
      this.style = savedStyle;
    }
    return layer;
  }


  /**
   * Draw `body` once into a stored layer and paste that layer on later calls
   * with the same `key`. The key must name everything the pixels depend on
   * (including the transform at the first call); a new key redraws.
   */
  cache(key: string, body: () => void): void {
    const layer = this.#cache.get(key) ?? this.#cache.set(key, this.#onLayer(body, { opacity: 1, keep: true }));
    drawLayer(this.ctx, { image: layer.image, width: this.width, height: this.height, opacity: 1, op: this.#composite() });
  }

  /**
   * A sprite: `body` drawn once, in its own coordinates (0..width, 0..height),
   * and kept under `key`. Later calls with the key return it without drawing.
   * Place it with `image`, under any transform.
   */
  sprite(options: SpriteOptions, body: () => void): Sprite {
    const { key, width, height } = options;
    if (!(width > 0 && height > 0 && width <= this.width && height <= this.height)) {
      throw new SketchUsageError({ detail: `sprite "${key}" size ${width}×${height} must be positive and fit the canvas` });
    }
    if (this.#sprites.get(key) === undefined) this.#sprites.set(key, this.#onLayer(body, { opacity: 1, into: this.#makeLayer({ width, height }) }));
    return { kind: "sprite", key, width, height };
  }

  /** Draw a sprite with its top-left corner at (x, y), under the current transform, at `opacity` (default 1). */
  image(...args: [Sprite, number, number, number?]): void {
    const [sprite, x, y, opacity] = args;
    const layer = this.#sprites.get(sprite.key);
    if (layer === undefined) throw new SketchUsageError({ detail: `sprite "${sprite.key}" is not defined in this run (call sprite() first)` });
    const ctx = this.ctx;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * (opacity ?? 1);
    withComposite(ctx, { op: this.#composite(), draw: () => ctx.drawImage(layer.image, 0, 0, sprite.width, sprite.height, x, y, sprite.width, sprite.height) });
    ctx.globalAlpha = alpha;
  }

  text(...args: [string, number, number]): void {
    const [content, x, y] = args;
    const ctx = this.ctx;
    ctx.font = `${this.style.textSize}px sans-serif`;
    ctx.textAlign = this.style.textAlignH;
    ctx.textBaseline = this.style.textAlignV;
    if (this.style.fillEnabled) {
      ctx.fillStyle = this.#resolvePaint(this.style.fillColor);
      withComposite(ctx, { op: this.#composite(), draw: () => ctx.fillText(content, x, y) });
    }
  }

  /** Flattening step in user units: half a device pixel under the current transform. */
  #step(): number {
    const m = this.ctx.getTransform();
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    return scale > 0 ? 0.5 / scale : 0.5;
  }

  #composite(): string {
    return this.style.erasing ? "destination-out" : compositeOp(this.style.blend);
  }


  #paint(contours: () => Contour[]): void {
    if (this.style.fillEnabled) {
      const ctx = this.ctx;
      const paint = this.style.fillColor;
      ctx.fillStyle = this.#resolvePaint(paint);
      withComposite(ctx, { op: this.#composite(), draw: () => inPaintSpace(ctx, { paint, fill: () => ctx.fill() }) });
    }
    this.#strokeShape(contours);
  }

  #strokeShape(contours: () => Contour[]): void {
    if (!this.style.strokeEnabled) return;
    const brush = this.style.brush;
    if (brush === undefined) {
      const ctx = this.ctx;
      ctx.strokeStyle = this.#resolvePaint(this.style.strokeColor);
      ctx.lineWidth = this.style.strokeW;
      withComposite(ctx, { op: this.#composite(), draw: () => ctx.stroke() });
      return;
    }
    const { erasing, blend } = this.style;
    const composite = erasing ? "destination-out" : compositeOp(blend === "normal" ? (brush.blend ?? "normal") : blend);
    const peak = renderMark({
      target: this.ctx,
      scratch: this.#pool.scratch(),
      measure: this.#measure,
      canvas: { width: this.width, height: this.height },
      contours: contours(),
      paint: this.style.strokeColor,
      weight: this.style.strokeW,
      brush,
      gesture: this.style.gesture,
      paper: () => this.#paper.layer(),
      composite,
    });
    if (peak !== undefined && !erasing) this.#faint.check(peak, this.#alphaStack);
  }
}
