// The headless canvas a TEA run draws on: a @napi-rs/canvas canvas, the
// shared Painter over it, the run's seeded random stream, pixel readback for
// capture, and the log/snapshot channel to the recorder.
import { createCanvas } from "@napi-rs/canvas";
import type { SKRSContext2D } from "@napi-rs/canvas";
import { formatArgs } from "../core/format.js";
import type { Ctx2D, Layer, LayerImage } from "../core/paint.js";
import { Painter } from "../core/painter/engine.js";
import { SeededRandom } from "../core/prng.js";
import type { SketchHost } from "../core/types.js";
import { SketchUsageError } from "./errors.js";

/** An offscreen Skia canvas of `size`, as a Painter layer (groups, brush marks, paper). */
function makeSkiaLayer(size: { width: number; height: number }): Layer {
  const canvas = createCanvas(size.width, size.height);
  return {
    // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D (wider fillStyle union)
    ctx: canvas.getContext("2d") as unknown as Ctx2D,
    // eslint-disable-next-line no-restricted-syntax -- opaque-image boundary: a Skia Canvas is what this runtime's drawImage accepts
    image: canvas as unknown as LayerImage,
  };
}

export class Surface {
  readonly width: number;
  readonly height: number;
  readonly painter: Painter;
  #canvasCtx: SKRSContext2D;
  #host: SketchHost;
  #random: SeededRandom;

  constructor(options: { width: number; height: number; host: SketchHost; seed: number; outline?: boolean }) {
    const { width, height } = options;
    this.width = width;
    this.height = height;
    this.#host = options.host;
    this.#random = new SeededRandom(options.seed);
    const canvas = createCanvas(width, height);
    this.#canvasCtx = canvas.getContext("2d");
    this.painter = new Painter({
      // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D (wider fillStyle union); a Skia Canvas is what this runtime's drawImage accepts
      surface: { ctx: this.#canvasCtx as unknown as Ctx2D, image: canvas as unknown as LayerImage },
      width,
      height,
      makeLayer: makeSkiaLayer,
      warn: (message) => this.#host.recordLog({ level: "warn", message }),
      outline: options.outline === true,
    });
  }

  /** The raw context drawing lands on now: the canvas, or the innermost open group's layer. */
  get ctx(): SKRSContext2D {
    // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: every context the Painter holds was made by @napi-rs/canvas (the canvas or a makeSkiaLayer layer)
    return this.painter.ctx as unknown as SKRSContext2D;
  }

  /** The current frame's pixels, for capture. */
  readPixels(): { width: number; height: number; data: Uint8ClampedArray } {
    const image = this.#canvasCtx.getImageData(0, 0, this.width, this.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  /** Draw this frame's `--outline` overlay (the runtime calls it after `draw`). */
  finishFrame(): void {
    this.painter.finishFrame();
  }

  /** The next number from the run's seeded stream, in [0, 1). */
  random(): number {
    return this.#random.next();
  }

  randomChoice<T>(items: readonly T[]): T {
    const picked = items[Math.floor(this.#random.next() * items.length)];
    if (picked === undefined) throw new SketchUsageError({ detail: "randomChoice() requires a non-empty array" });
    return picked;
  }

  log(...args: readonly unknown[]): void {
    this.#host.recordLog({ level: "log", message: formatArgs(args) });
  }

  snapshot(label?: string): void {
    this.#host.requestSnapshot(label);
  }
}
