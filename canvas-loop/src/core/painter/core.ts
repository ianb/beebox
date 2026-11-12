// The core of the drawing engine (see engine.ts for the shape primitives). A single implementation
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
import { SketchUsageError, assertUnit } from "../errors.js";
import { StyledPainter } from "./style.js";
import type { StyleState } from "./style.js";
import type { ClipShape, Ctx2D, Ctx2DGradient, CtxImageData, CtxTransform, GroupOptions, Layer, MakeLayer, Paint, Sprite, SpriteOptions } from "../paint.js";
import { compositeOp, inPaintSpace, isPathShape, resolveGradient, tracePath, tracePolygon } from "../paint.js";
import { DebugOverlay, outlinePoints, toCanvas } from "./debug.js";
import { FaintWatch } from "./faint.js";
import { LayerCache, LayerPool, drawLayer, isShapeList, replaceInShapes, withComposite } from "./layers.js";
import { paperOverlay } from "../brush/paper.js";

/** True for the identity transform. */
function isIdentity(m: CtxTransform): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

/**
 * The shared p5-like drawing surface over a structural `Ctx2D`. Drawing is
 * deterministic: colors are CSS strings or plain-data gradient handles, and
 * brush jitter comes from per-mark seeds. The engine mutates the context but
 * holds no time/random/input state.
 */
export class PainterCore extends StyledPainter {
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
  /** Device pixels per logical pixel (1 headless; the screen's ratio in a browser). */
  readonly pixelRatio: number;
  // The canvas in device pixels: layers, pastes and pixel reads use this size.
  #device: { width: number; height: number };
  #debug: DebugOverlay;
  // Names of the sprites/caches being drawn into, innermost last (for warnings and outlines).
  #where: string[] = [];
  // Faint-mark checks read pixels back; only done when someone listens for warnings.
  #measure: boolean;

  constructor(options: { ctx: Ctx2D; width: number; height: number; makeLayer: MakeLayer; warn?: (message: string) => void; outline?: boolean; pixelRatio?: number }) {
    super();
    this.#ctxStack = [options.ctx];
    this.pixelRatio = options.pixelRatio ?? 1;
    this.#device = { width: Math.round(options.width * this.pixelRatio), height: Math.round(options.height * this.pixelRatio) };
    this.#paper = new PaperSheet(options.makeLayer, { size: this.#device, pixelRatio: this.pixelRatio });
    this.#faint = new FaintWatch(options.warn ?? (() => {}));
    this.#measure = options.warn !== undefined;
    this.#debug = new DebugOverlay(options.outline === true);
    this.#pool = new LayerPool(options.makeLayer, this.#device);
    // A high-density canvas (pixelRatio > 1) draws in logical units under a base scale.
    if (this.pixelRatio !== 1) options.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
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

  protected resolvePaint(paint: Paint): string | Ctx2DGradient {
    if (typeof paint === "string") return paint;
    return resolveGradient(this.ctx, paint);
  }

  /** Darken the paper's valleys across everything drawn so far, so flat colour looks printed on paper. */
  paperTexture(amount: number): void {
    assertUnit(amount, "paperTexture amount");
    paperOverlay(this.ctx, { paper: this.#paper.layer(), amount, ...this.#device });
  }

  // Clip to a polygon/path (or the union of several) for the duration of `body`, restoring afterward.
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    for (const one of isShapeList(shape) ? shape : [shape]) this.#outline("clip", { label: "clip", shape: one });
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
    const before = parent.getImageData(0, 0, this.#device.width, this.#device.height);
    const layer = this.#onLayer(body, { opacity: 1, start: before });
    // `layer` and `scratch` take putImageData, so they are never pooled: @napi-rs/canvas reads such a
    // canvas lazily when it is drawn, and clearing it for reuse would blank what was drawn from it.
    const scratch = this.#makeLayer(this.#device);
    this.#pool.borrow((mask) => replaceInShapes(parent, { layer, mask, scratch, before, shapes, transform, ...this.#device }));
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
    drawLayer(this.ctx, { image: layer.image, ...this.#device, opacity, op });
    this.#pool.release(layer);
  }

  /** Run `body` drawing onto a fresh full-canvas layer; state changes inside do not leak out. */
  #onLayer(body: () => void, options: { opacity: number; start?: CtxImageData; keep?: boolean; into?: Layer; where?: string }): Layer {
    const { opacity, start } = options;
    // A sprite draws into its own layer in local coordinates; a cache keeps its layer for good;
    // the rest come from the pool and go back after use.
    const pr = this.pixelRatio;
    const m = options.into === undefined ? this.ctx.getTransform() : { a: pr, b: 0, c: 0, d: pr, e: 0, f: 0 };
    const fresh = options.keep === true || start !== undefined;
    const layer = options.into ?? (fresh ? this.#makeLayer(this.#device) : this.#pool.acquire());
    if (start !== undefined) layer.ctx.putImageData(start, 0, 0);
    layer.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    const savedFloor = this.#floor;
    const savedStyle = { ...this.style };
    const depth = this.#styleStack.length;
    this.#floor = depth;
    this.#ctxStack.push(layer.ctx);
    this.#alphaStack.push(opacity);
    if (options.where !== undefined) this.#where.push(options.where);
    try {
      body();
    } finally {
      if (options.where !== undefined) this.#where.pop();
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
    const layer = this.#cache.get(key) ?? this.#cache.set(key, this.#onLayer(body, { opacity: 1, keep: true, where: `cache "${key}"` }));
    drawLayer(this.ctx, { image: layer.image, ...this.#device, opacity: 1, op: this.composite() });
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
    if (this.#sprites.get(key) === undefined) this.#sprites.set(key, this.#onLayer(body, { opacity: 1, into: this.#makeLayer({ width: Math.ceil(width * this.pixelRatio), height: Math.ceil(height * this.pixelRatio) }), where: `sprite "${key}"` }));
    return { kind: "sprite", key, width, height };
  }

  /** Draw a sprite with its top-left corner at (x, y), under the current transform, at `opacity` (default 1). */
  image(...args: [Sprite, number, number, number?]): void {
    const [sprite, x, y, opacity] = args;
    const layer = this.#sprites.get(sprite.key);
    if (layer === undefined) throw new SketchUsageError({ detail: `sprite "${sprite.key}" is not defined in this run (call sprite() first)` });
    const ctx = this.ctx;
    this.#outline("sprite", { label: sprite.key, rect: [x, y, sprite.width, sprite.height] });
    const draw = (): void => {
      const target = this.ctx;
      const alpha = target.globalAlpha;
      target.globalAlpha = alpha * (opacity ?? 1);
      withComposite(target, { op: this.composite(), draw: () => target.drawImage(layer.image, 0, 0, sprite.width * this.pixelRatio, sprite.height * this.pixelRatio, x, y, sprite.width, sprite.height) });
      target.globalAlpha = alpha;
    };
    if (this.style.erasing && !isIdentity(ctx.getTransform())) this.#viaLayer(draw);
    else draw();
  }

  /** With `run --outline`, a labelled box over the frame (e.g. a hit area); otherwise nothing. */
  debugBox(...args: [string, number, number, number, number]): void {
    this.#outline("box", { label: args[0], rect: [args[1], args[2], args[3], args[4]] });
  }

  /** Draw this frame's debug outlines over the canvas (the runtime calls it after `draw`). */
  finishFrame(): void {
    this.#debug.draw(this.#ctxStack[0] ?? this.ctx);
  }

  #outline(kind: "sprite" | "clip" | "box", args: { label: string; rect?: readonly [number, number, number, number]; shape?: ClipShape }): void {
    // Outlines are in canvas coordinates; inside a sprite the coordinates are the sprite's own.
    if (!this.#debug.enabled || this.#where.some((w) => w.startsWith("sprite"))) return;
    const m = this.ctx.getTransform();
    for (const points of outlinePoints(args)) this.#debug.add({ kind, label: args.label, points: toCanvas(m, points) });
  }

  /** Flattening step in user units: half a device pixel under the current transform. */
  protected step(): number {
    const m = this.ctx.getTransform();
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
    return scale > 0 ? 0.5 / scale : 0.5;
  }

  protected composite(): string {
    return this.style.erasing ? "destination-out" : compositeOp(this.style.blend);
  }


  /**
   * Fill and stroke the shape `trace` lays down, per the current style. While
   * erasing under a transform, the shape is drawn normally on a pooled layer and
   * that layer is erased with under an identity transform: @napi-rs/canvas 1.0.2
   * limits a destination-out fill under a transform to the quadrant past the
   * translation origin.
   */
  protected paintShape(trace: (ctx: Ctx2D) => void, shape: { contours: () => Contour[]; fill: boolean }): void {
    if (!this.style.erasing || isIdentity(this.ctx.getTransform())) {
      trace(this.ctx);
      this.#fillAndStroke(shape);
      return;
    }
    this.#viaLayer(() => {
      trace(this.ctx);
      this.#fillAndStroke(shape);
    });
  }

  /** Draw `body` with source-over on a pooled layer under the current transform, then erase with it (identity transform). */
  #viaLayer(body: () => void): void {
    const target = this.ctx;
    const m = target.getTransform();
    this.#pool.borrow((layer) => {
      layer.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      this.#ctxStack.push(layer.ctx);
      this.style.erasing = false;
      try {
        body();
      } finally {
        this.style.erasing = true;
        this.#ctxStack.pop();
      }
      drawLayer(target, { image: layer.image, ...this.#device, opacity: 1, op: "destination-out" });
    });
  }

  #fillAndStroke(shape: { contours: () => Contour[]; fill: boolean }): void {
    if (shape.fill && this.style.fillEnabled) {
      const ctx = this.ctx;
      const paint = this.style.fillColor;
      ctx.fillStyle = this.resolvePaint(paint);
      withComposite(ctx, { op: this.composite(), draw: () => inPaintSpace(ctx, { paint, fill: () => ctx.fill() }) });
    }
    this.#strokeShape(shape.contours);
  }

  #strokeShape(contours: () => Contour[]): void {
    if (!this.style.strokeEnabled) return;
    const brush = this.style.brush;
    if (brush === undefined) {
      const ctx = this.ctx;
      ctx.strokeStyle = this.resolvePaint(this.style.strokeColor);
      ctx.lineWidth = this.style.strokeW;
      withComposite(ctx, { op: this.composite(), draw: () => ctx.stroke() });
      return;
    }
    const { erasing, blend } = this.style;
    const composite = erasing ? "destination-out" : compositeOp(blend === "normal" ? (brush.blend ?? "normal") : blend);
    const peak = renderMark({
      target: this.ctx,
      scratch: this.#pool.scratch(),
      paintScratch: this.#pool.paintScratch(),
      measure: this.#measure,
      canvas: this.#device,
      contours: contours(),
      paint: this.style.strokeColor,
      weight: this.style.strokeW,
      brush,
      gesture: this.style.gesture,
      paper: () => this.#paper.layer(),
      composite,
    });
    if (peak !== undefined && !erasing && this.style.gesture.faint !== true) this.#faint.check(peak, { groupAlphas: this.#alphaStack, where: this.#where.at(-1) });
  }
}
