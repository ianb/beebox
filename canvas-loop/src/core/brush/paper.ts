// The paper texture: a canvas-sized layer whose alpha marks the paper's valleys,
// where a grainy brush leaves less pigment. Generated in JS from hash noise, so
// it is the same in every runtime.
import type { Layer, MakeLayer } from "../paint.js";
import { rand } from "./random.js";
import type { Paper } from "./types.js";

function lattice(seed: number, at: { channel: number; x: number; y: number }): number {
  return rand(seed, { channel: at.channel, index: Math.imul(at.x, 73856093) ^ Math.imul(at.y, 19349663) });
}

/** Smooth 2-D value noise in [0, 1] at (x, y), lattice spacing 1. */
function noise2(seed: number, at: { channel: number; x: number; y: number }): number {
  const ix = Math.floor(at.x);
  const iy = Math.floor(at.y);
  const fx = at.x - ix;
  const fy = at.y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const c = at.channel;
  const a = lattice(seed, { channel: c, x: ix, y: iy });
  const b = lattice(seed, { channel: c, x: ix + 1, y: iy });
  const d = lattice(seed, { channel: c, x: ix, y: iy + 1 });
  const e = lattice(seed, { channel: c, x: ix + 1, y: iy + 1 });
  return a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy;
}

/** Build the paper layer for a canvas. */
export function makePaper(makeLayer: MakeLayer, args: { width: number; height: number; paper: Paper }): Layer {
  const { width, height } = args;
  const scale = args.paper.scale ?? 3;
  const contrast = args.paper.contrast ?? 0.7;
  const seed = args.paper.seed ?? 1;
  const layer = makeLayer({ width, height });
  const image = layer.ctx.createImageData(width, height);
  const lo = 0.5 - 0.35 * contrast;
  const hi = 0.5 + 0.15 * (1 - contrast);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tooth =
        0.55 * noise2(seed, { channel: 1, x: x / scale, y: y / scale }) +
        0.3 * noise2(seed, { channel: 2, x: x / (scale * 0.45), y: y / (scale * 0.45) }) +
        0.15 * rand(seed, { channel: 3, index: y * width + x });
      const f = Math.min(1, Math.max(0, (tooth - lo) / (hi - lo)));
      image.data[(y * width + x) * 4 + 3] = Math.round(255 * f * f * (3 - 2 * f));
    }
  }
  layer.ctx.putImageData(image, 0, 0);
  return layer;
}
