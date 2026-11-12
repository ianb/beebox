// Layer compositing for the Painter: drawing a finished layer back onto its
// parent, and masking a layer to the union of several shapes.
import type { ClipShape, Ctx2D, CtxImageData, CtxTransform, Layer, LayerImage, MakeLayer } from "../paint.js";
import { isPathShape, tracePath, tracePolygon } from "../paint.js";

/** Draw a full-canvas layer image onto `ctx` at device scale, once. */
export function drawLayer(ctx: Ctx2D, args: { image: LayerImage; width: number; height: number; opacity: number; op: string }): void {
  ctx.save();
  ctx.resetTransform();
  ctx.globalAlpha = args.opacity;
  ctx.globalCompositeOperation = args.op;
  ctx.drawImage(args.image, 0, 0, args.width, args.height, 0, 0, args.width, args.height);
  ctx.restore();
}

/** Keep only the parts of `layer` inside `mask`'s painted pixels. */
export function maskLayer(layer: Layer, args: { mask: Layer; width: number; height: number }): void {
  drawLayer(layer.ctx, { image: args.mask.image, width: args.width, height: args.height, opacity: 1, op: "destination-in" });
}

/** Fill every shape opaque on `ctx` (under its current transform): their union. */
export function fillShapes(ctx: Ctx2D, shapes: readonly ClipShape[]): void {
  ctx.fillStyle = "#000000";
  for (const shape of shapes) {
    if (isPathShape(shape)) tracePath(ctx, shape);
    else tracePolygon(ctx, shape);
    ctx.fill();
  }
}

/** A list of clip shapes, as opposed to one shape: its first element's first element is itself an array. */
export function isShapeList(shape: ClipShape | readonly ClipShape[]): shape is readonly ClipShape[] {
  const first = shape[0];
  return first !== undefined && Array.isArray(first[0]);
}

/**
 * Replace the part of `parent` inside the union of `shapes` with `layer`'s
 * pixels there. Each pixel becomes before × (1 − m) + result × m, where m is
 * the shapes' coverage, so an antialiased edge blends instead of losing alpha.
 * The sum is built on `scratch` (with "lighter", an exact premultiplied add),
 * then copied over `parent`, which keeps any clip the parent already has.
 */
export function replaceInShapes(
  parent: Ctx2D,
  args: {
    layer: Layer;
    mask: Layer;
    scratch: Layer;
    before: CtxImageData;
    shapes: readonly ClipShape[];
    transform: CtxTransform;
    width: number;
    height: number;
  },
): void {
  const { layer, mask, scratch, width, height } = args;
  const m = args.transform;
  mask.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  fillShapes(mask.ctx, args.shapes);
  maskLayer(layer, { mask, width, height });
  scratch.ctx.putImageData(args.before, 0, 0);
  drawLayer(scratch.ctx, { image: mask.image, width, height, opacity: 1, op: "destination-out" });
  drawLayer(scratch.ctx, { image: layer.image, width, height, opacity: 1, op: "lighter" });
  parent.save();
  parent.resetTransform();
  parent.clearRect(0, 0, width, height);
  parent.restore();
  drawLayer(parent, { image: scratch.image, width, height, opacity: 1, op: "source-over" });
}

/** Run `draw` with `op` as the composite operation, then put the previous one back. */
export function withComposite(ctx: Ctx2D, args: { op: string; draw: () => void }): void {
  const previous = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = args.op;
  try {
    args.draw();
  } finally {
    ctx.globalCompositeOperation = previous;
  }
}

/** Layers stored by key for `cache()`, oldest dropped first past the limit. */
export class LayerCache {
  #layers = new Map<string, Layer>();
  #limit: number;

  constructor(limit: number) {
    this.#limit = limit;
  }

  get(key: string): Layer | undefined {
    return this.#layers.get(key);
  }

  set(key: string, layer: Layer): Layer {
    this.#layers.set(key, layer);
    const oldest = this.#layers.keys().next();
    if (this.#layers.size > this.#limit && oldest.done !== true) this.#layers.delete(oldest.value);
    return layer;
  }
}

/**
 * Canvas-sized layers, reused: creating an offscreen canvas for every group,
 * clip and brush mark on every frame dominates an animation's cost.
 */
export class LayerPool {
  #make: MakeLayer;
  #size: { width: number; height: number };
  #free: Layer[] = [];
  #scratch: Layer | undefined;
  #paintScratch: Layer | undefined;

  constructor(make: MakeLayer, size: { width: number; height: number }) {
    this.#make = make;
    this.#size = size;
  }

  /** A clear, identity-transform layer; give it back with `release` when done. */
  acquire(): Layer {
    return this.#free.pop() ?? this.#make(this.#size);
  }

  /** Clear a layer and keep it for the next `acquire`. */
  release(layer: Layer): void {
    const { ctx } = layer;
    ctx.resetTransform();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, this.#size.width, this.#size.height);
    this.#free.push(layer);
  }

  /** Lend a layer for the length of `body`, then take it back. */
  borrow(body: (layer: Layer) => void): void {
    const layer = this.acquire();
    body(layer);
    this.release(layer);
  }

  /** A second reusable layer marks paint gradients on. */
  paintScratch(): Layer {
    this.#paintScratch ??= this.#make(this.#size);
    return this.#paintScratch;
  }

  /** The one layer brush marks draw into (each mark clears and clips its own corner of it). */
  scratch(): Layer {
    this.#scratch ??= this.#make(this.#size);
    return this.#scratch;
  }
}
