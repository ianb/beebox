// The paper texture: a canvas-sized layer whose alpha marks the paper's valleys,
// where a grainy brush leaves less pigment. Generated in JS from hash noise, so
// it is the same in every runtime.
import type { Ctx2D, Layer, MakeLayer } from "../paint.js";
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

/**
 * Strongest darkening of a paper valley at `amount` 1. The paper mask is
 * high-contrast (it cuts grain out of brush marks), so a page-wide overlay uses
 * a fraction of it: real paper tooth is a faint texture.
 */
const OVERLAY_STRENGTH = 0.18;

/** Multiply the paper's valleys over everything already on `ctx`, at `amount` (0..1) strength. */
export function paperOverlay(ctx: Ctx2D, args: { paper: Layer; amount: number; width: number; height: number }): void {
  ctx.save();
  ctx.resetTransform();
  ctx.globalAlpha = args.amount * OVERLAY_STRENGTH;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(args.paper.image, 0, 0, args.width, args.height, 0, 0, args.width, args.height);
  ctx.restore();
}

/** The canvas's current paper: its settings, and the texture layer built from them on first use. */
export class PaperSheet {
  #makeLayer: MakeLayer;
  #size: { width: number; height: number };
  #pixelRatio: number;
  #paper: Paper = {};
  #layer: Layer | undefined;

  /** `size` is in device pixels; the tooth is scaled by `pixelRatio` so it looks the same at any density. */
  constructor(makeLayer: MakeLayer, args: { size: { width: number; height: number }; pixelRatio: number }) {
    this.#makeLayer = makeLayer;
    this.#size = args.size;
    this.#pixelRatio = args.pixelRatio;
  }

  /** Change the paper; the texture is rebuilt only when the settings actually differ. */
  set(paper: Paper): void {
    const same = paper.scale === this.#paper.scale && paper.contrast === this.#paper.contrast && paper.seed === this.#paper.seed;
    if (same) return;
    this.#paper = paper;
    this.#layer = undefined;
  }

  layer(): Layer {
    const scale = (this.#paper.scale ?? 3) * this.#pixelRatio;
    this.#layer ??= makePaper(this.#makeLayer, { ...this.#size, paper: { ...this.#paper, scale } });
    return this.#layer;
  }
}
