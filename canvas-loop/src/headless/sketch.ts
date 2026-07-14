import { createCanvas } from "@napi-rs/canvas";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { SketchUsageError } from "./errors.js";
import { formatArgs } from "./format.js";
import type { ClipShape, ColorStop, Ctx2D, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "./paint.js";
import { Painter } from "./painter.js";
import { SeededRandom } from "./prng.js";
import type { SketchHost } from "./types.js";

// Mirror @napi-rs/canvas's (unexported) text-align unions — lib is ES2023 with
// no DOM, so the global CanvasTextAlign / CanvasTextBaseline aren't in scope.
type TextAlign = "center" | "end" | "left" | "right" | "start";
type TextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";

/**
 * A p5-like drawing surface in instance mode. The runtime constructs one Sketch
 * per run, updates its per-frame state, and calls the sketch module's
 * setup/draw/handlers against it. Drawing is delegated to the shared, context-
 * generic {@link Painter} (same engine the browser harness uses); Sketch owns the
 * headless-only concerns: canvas creation, seeded randomness, virtual time,
 * pixel readback, and the log/snapshot host channel.
 *
 * Escape hatch: `s.ctx` exposes the raw @napi-rs/canvas SKRSContext2D for
 * anything this subset doesn't cover.
 */
export class Sketch {
  width = 0;
  height = 0;
  frameCount = 0;
  mouseX = 0;
  mouseY = 0;
  mouseIsPressed = false;
  readonly keysDown = new Set<string>();

  #canvas: Canvas | undefined;
  #ctx: SKRSContext2D | undefined;
  #painter: Painter | undefined;
  #host: SketchHost;
  #fps: number;
  #random: SeededRandom;

  constructor(options: { host: SketchHost; seed: number; fps: number }) {
    this.#host = options.host;
    this.#fps = options.fps;
    this.#random = new SeededRandom(options.seed);
  }

  // ── canvas + time ────────────────────────────────────────────────
  createCanvas(width: number, height: number): void {
    if (this.#canvas !== undefined) {
      throw new SketchUsageError({ detail: "createCanvas() called more than once" });
    }
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.width = width;
    this.height = height;
    // The Skia context satisfies the structural Ctx2D the Painter uses; the only
    // gap is a wider `fillStyle` union (it also allows CanvasPattern, which the
    // engine never sets), so structural assignability needs one boundary cast.
    // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: SKRSContext2D is a superset of Ctx2D (wider fillStyle union)
    this.#painter = new Painter({ ctx: ctx as unknown as Ctx2D, width, height });
  }

  get ctx(): SKRSContext2D {
    return this.#requireCtx();
  }

  /** Raw pixel buffer of the current frame — used by the runtime for capture. */
  readPixels(): { width: number; height: number; data: Uint8ClampedArray } {
    const ctx = this.#requireCtx();
    const image = ctx.getImageData(0, 0, this.width, this.height);
    return { width: image.width, height: image.height, data: image.data };
  }

  millis(): number {
    return (this.frameCount / this.#fps) * 1000;
  }

  #requireCtx(): SKRSContext2D {
    if (this.#ctx === undefined) {
      throw new SketchUsageError({ detail: "call createCanvas() in setup() before drawing" });
    }
    return this.#ctx;
  }

  #requirePainter(): Painter {
    if (this.#painter === undefined) {
      throw new SketchUsageError({ detail: "call createCanvas() in setup() before drawing" });
    }
    return this.#painter;
  }

  // ── seeded randomness ────────────────────────────────────────────
  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  random(a?: number, b?: number): number {
    const r = this.#random.next();
    if (a === undefined) return r;
    if (b === undefined) return r * a;
    return a + r * (b - a);
  }

  randomChoice<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new SketchUsageError({ detail: "randomChoice() requires a non-empty array" });
    }
    const picked = items[Math.floor(this.#random.next() * items.length)];
    if (picked === undefined) {
      throw new SketchUsageError({ detail: "randomChoice() drew an out-of-range index" });
    }
    return picked;
  }

  // ── style (delegated to Painter) ─────────────────────────────────
  fill(paint: Paint): void {
    this.#requirePainter().fill(paint);
  }
  noFill(): void {
    this.#requirePainter().noFill();
  }
  stroke(paint: Paint): void {
    this.#requirePainter().stroke(paint);
  }
  noStroke(): void {
    this.#requirePainter().noStroke();
  }
  strokeWeight(weight: number): void {
    this.#requirePainter().strokeWeight(weight);
  }
  textSize(size: number): void {
    this.#requirePainter().textSize(size);
  }
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void {
    if (vertical === undefined) this.#requirePainter().textAlign(horizontal);
    else this.#requirePainter().textAlign(horizontal, vertical);
  }

  push(): void {
    this.#requirePainter().push();
  }
  pop(): void {
    if (!this.#requirePainter().pop()) {
      throw new SketchUsageError({ detail: "pop() called without a matching push()" });
    }
  }

  // ── transforms ───────────────────────────────────────────────────
  translate(x: number, y: number): void {
    this.#requirePainter().translate(x, y);
  }
  rotate(radians: number): void {
    this.#requirePainter().rotate(radians);
  }
  scale(x: number, y?: number): void {
    if (y === undefined) this.#requirePainter().scale(x);
    else this.#requirePainter().scale(x, y);
  }

  // ── gradients ────────────────────────────────────────────────────
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    return this.#requirePainter().linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return this.#requirePainter().radialGradient(...args);
  }

  // ── drawing ──────────────────────────────────────────────────────
  background(paint: Paint): void {
    this.#requirePainter().background(paint);
  }
  rect(...args: [number, number, number, number]): void {
    this.#requirePainter().rect(...args);
  }
  circle(...args: [number, number, number]): void {
    this.#requirePainter().circle(...args);
  }
  ellipse(...args: [number, number, number, number]): void {
    this.#requirePainter().ellipse(...args);
  }
  line(...args: [number, number, number, number]): void {
    this.#requirePainter().line(...args);
  }
  triangle(...args: [number, number, number, number, number, number]): void {
    this.#requirePainter().triangle(...args);
  }
  arc(...args: [number, number, number, number, number]): void {
    this.#requirePainter().arc(...args);
  }
  polygon(points: readonly Vec2[]): void {
    this.#requirePainter().polygon(points);
  }
  path(commands: readonly PathCommand[]): void {
    this.#requirePainter().path(commands);
  }
  clip(shape: ClipShape, body: () => void): void {
    this.#requirePainter().clip(shape, body);
  }
  text(...args: [string, number, number]): void {
    this.#requirePainter().text(...args);
  }

  // ── transcript ───────────────────────────────────────────────────
  log(...args: readonly unknown[]): void {
    this.#host.recordLog({ level: "log", message: formatArgs(args) });
  }

  snapshot(label?: string): void {
    this.#host.requestSnapshot(label);
  }
}
