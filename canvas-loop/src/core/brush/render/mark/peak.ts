// How strong a mark landed, for the faint-mark warning. It reads pixels back,
// which is cheap headless and stalls the GPU in a browser, so only a painter
// with a warning sink asks for it.
import type { Layer } from "../../../ctx2d.js";
import type { Bounds } from "./render.js";

/** The strongest pixel's alpha (0..1) on a layer, sampling every other pixel. */
export function peakAlpha(layer: Layer, b: Bounds): number {
  const { data } = layer.ctx.getImageData(0, 0, b.w, b.h);
  let peak = 0;
  for (let i = 3; i < data.length; i += 8) peak = Math.max(peak, data[i] ?? 0);
  return peak / 255;
}
