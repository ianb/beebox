// The soft dab: a soft-tipped stamp brush lays down hundreds of round, fading
// dabs per mark. Building a radial gradient for each one is slow (most of all in
// a browser), so the dab is drawn once into its own scratch layer and copied,
// scaled, for every dab after that.
import type { Ctx2D, Layer, LayerImage } from "../../paint.js";
import type { Brush } from "../types.js";
import type { ScratchName } from "./mark.js";

/** Radius, in pixels, of the pre-drawn soft dab. */
export const SOFT_DAB_RADIUS = 64;

/** Black fading to clear, filling a circle at the layer's top-left. */
function paintSoftDab(ctx: Ctx2D): void {
  const r = SOFT_DAB_RADIUS;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, r * 2, r * 2);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(0, 0, 0, 1)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Layers already holding the dab: the "dab" scratch is drawn once and kept. */
const dabbed = new WeakSet<Layer>();

/** The shared soft dab for a soft-tipped stamp brush; undefined for any other
 * brush, or when the canvas is too small to hold it. */
export function softDab(brush: Brush, args: { canvas: { width: number; height: number }; scratch: (name: ScratchName) => Layer }): LayerImage | undefined {
  if (brush.kind !== "stamp" || brush.tip !== "soft") return undefined;
  if (args.canvas.width < SOFT_DAB_RADIUS * 2 || args.canvas.height < SOFT_DAB_RADIUS * 2) return undefined;
  const layer = args.scratch("dab");
  if (!dabbed.has(layer)) {
    paintSoftDab(layer.ctx);
    dabbed.add(layer);
  }
  return layer.image;
}
