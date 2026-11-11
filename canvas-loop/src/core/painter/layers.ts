// Layer compositing for the Painter: drawing a finished layer back onto its
// parent, and masking a layer to the union of several shapes.
import type { ClipShape, Ctx2D, CtxTransform, Layer, LayerImage } from "../paint.js";
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
 * pixels there (`mask` is a scratch layer). Outside the shapes, `parent` is
 * untouched; inside, transparent result pixels stay transparent.
 */
export function replaceInShapes(
  parent: Ctx2D,
  args: { layer: Layer; mask: Layer; shapes: readonly ClipShape[]; transform: CtxTransform; width: number; height: number },
): void {
  const { layer, mask, width, height } = args;
  const m = args.transform;
  mask.ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  fillShapes(mask.ctx, args.shapes);
  maskLayer(layer, { mask, width, height });
  drawLayer(parent, { image: mask.image, width, height, opacity: 1, op: "destination-out" });
  drawLayer(parent, { image: layer.image, width, height, opacity: 1, op: "source-over" });
}
