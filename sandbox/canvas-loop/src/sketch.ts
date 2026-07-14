import { createCanvas } from "@napi-rs/canvas";
import type { Canvas, SKRSContext2D } from "@napi-rs/canvas";
import { SketchUsageError } from "./errors.js";
import { formatArgs } from "./format.js";
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "./paint.js";
import { isPathShape, resolveGradient, tracePath, tracePolygon } from "./paint.js";
import { SeededRandom } from "./prng.js";
import type { SketchHost } from "./types.js";

// Mirror @napi-rs/canvas's (unexported) text-align unions — lib is ES2023 with
// no DOM, so the global CanvasTextAlign / CanvasTextBaseline aren't in scope.
type TextAlign = "center" | "end" | "left" | "right" | "start";
type TextBaseline = "alphabetic" | "bottom" | "hanging" | "ideographic" | "middle" | "top";
// The concrete gradient object @napi-rs returns — no DOM `CanvasGradient` global.
type CanvasGradientValue = ReturnType<SKRSContext2D["createLinearGradient"]>;

interface StyleState {
  fillColor: Paint;
  fillEnabled: boolean;
  strokeColor: Paint;
  strokeEnabled: boolean;
  strokeW: number;
  textSize: number;
  textAlignH: TextAlign;
  textAlignV: TextBaseline;
}

/**
 * A p5-like drawing surface in instance mode. The runtime constructs one Sketch
 * per run, updates its per-frame state, and calls the sketch module's
 * setup/draw/handlers against it. Drawing is deterministic: colors are CSS
 * strings, randomness comes from the seeded `random()`, and time from `millis()`.
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
  #host: SketchHost;
  #fps: number;
  #random: SeededRandom;
  #style: StyleState = {
    fillColor: "#ffffff",
    fillEnabled: true,
    strokeColor: "#000000",
    strokeEnabled: false,
    strokeW: 1,
    textSize: 12,
    textAlignH: "left",
    textAlignV: "alphabetic",
  };
  #styleStack: StyleState[] = [];

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
    this.#canvas = canvas;
    this.#ctx = canvas.getContext("2d");
    this.width = width;
    this.height = height;
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

  // ── style ────────────────────────────────────────────────────────
  fill(paint: Paint): void {
    this.#style.fillColor = paint;
    this.#style.fillEnabled = true;
  }
  noFill(): void {
    this.#style.fillEnabled = false;
  }
  stroke(paint: Paint): void {
    this.#style.strokeColor = paint;
    this.#style.strokeEnabled = true;
  }
  noStroke(): void {
    this.#style.strokeEnabled = false;
  }
  strokeWeight(weight: number): void {
    this.#style.strokeW = weight;
  }
  textSize(size: number): void {
    this.#style.textSize = size;
  }
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void {
    this.#style.textAlignH = horizontal;
    if (vertical !== undefined) this.#style.textAlignV = vertical;
  }

  push(): void {
    this.#requireCtx().save();
    this.#styleStack.push({ ...this.#style });
  }
  pop(): void {
    const restored = this.#styleStack.pop();
    if (restored === undefined) {
      throw new SketchUsageError({ detail: "pop() called without a matching push()" });
    }
    this.#requireCtx().restore();
    this.#style = restored;
  }

  // ── transforms ───────────────────────────────────────────────────
  translate(x: number, y: number): void {
    this.#requireCtx().translate(x, y);
  }
  rotate(radians: number): void {
    this.#requireCtx().rotate(radians);
  }
  scale(x: number, y?: number): void {
    this.#requireCtx().scale(x, y ?? x);
  }

  // ── gradients ────────────────────────────────────────────────────
  // Constructors return plain-data handles (see paint.ts); the ctx-bound
  // CanvasGradient is built lazily in #resolvePaint at paint time.
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    const [x1, y1, x2, y2, stops] = args;
    return { kind: "linear-gradient", x1, y1, x2, y2, stops };
  }

  // Concentric center→radius form (the glow/sky/vignette case); stored in the
  // general two-circle shape so the handle stays fully expressive.
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    const [x, y, radius, stops] = args;
    return { kind: "radial-gradient", x1: x, y1: y, r1: 0, x2: x, y2: y, r2: radius, stops };
  }

  #resolvePaint(paint: Paint): string | CanvasGradientValue {
    if (typeof paint === "string") return paint;
    return resolveGradient(this.#requireCtx(), paint);
  }

  // ── drawing ──────────────────────────────────────────────────────
  background(paint: Paint): void {
    const ctx = this.#requireCtx();
    ctx.save();
    ctx.resetTransform();
    // Resolve after resetTransform so a gradient's coords are canvas-space.
    ctx.fillStyle = this.#resolvePaint(paint);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  rect(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    this.#paint();
  }

  circle(...args: [number, number, number]): void {
    const [x, y, diameter] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.arc(x, y, diameter / 2, 0, Math.PI * 2);
    this.#paint();
  }

  ellipse(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.#paint();
  }

  line(...args: [number, number, number, number]): void {
    const [x1, y1, x2, y2] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    this.#stroke();
  }

  triangle(...args: [number, number, number, number, number, number]): void {
    const [x1, y1, x2, y2, x3, y3] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    this.#paint();
  }

  arc(...args: [number, number, number, number, number]): void {
    const [x, y, radius, startAngle, endAngle] = args;
    const ctx = this.#requireCtx();
    ctx.beginPath();
    ctx.arc(x, y, radius, startAngle, endAngle);
    this.#paint();
  }

  /** Closed polygon through `points`, filled/stroked per the current state. */
  polygon(points: readonly Vec2[]): void {
    tracePolygon(this.#requireCtx(), points);
    this.#paint();
  }

  /** Render a `PathCommand` list, then fill/stroke per the current state. */
  path(commands: readonly PathCommand[]): void {
    tracePath(this.#requireCtx(), commands);
    this.#paint();
  }

  // Clip to a polygon/path for the duration of `body`, restoring afterward. The
  // one sanctioned callback: it scopes state (not data), and still serializes in
  // principle as push-clip / pop-clip commands around body's draws.
  clip(shape: ClipShape, body: () => void): void {
    this.push();
    try {
      const ctx = this.#requireCtx();
      if (isPathShape(shape)) tracePath(ctx, shape);
      else tracePolygon(ctx, shape);
      ctx.clip();
      body();
    } finally {
      this.pop();
    }
  }

  text(...args: [string, number, number]): void {
    const [content, x, y] = args;
    const ctx = this.#requireCtx();
    ctx.font = `${this.#style.textSize}px sans-serif`;
    ctx.textAlign = this.#style.textAlignH;
    ctx.textBaseline = this.#style.textAlignV;
    if (this.#style.fillEnabled) {
      ctx.fillStyle = this.#resolvePaint(this.#style.fillColor);
      ctx.fillText(content, x, y);
    }
  }

  #paint(): void {
    const ctx = this.#requireCtx();
    if (this.#style.fillEnabled) {
      ctx.fillStyle = this.#resolvePaint(this.#style.fillColor);
      ctx.fill();
    }
    this.#stroke();
  }

  #stroke(): void {
    if (!this.#style.strokeEnabled) return;
    const ctx = this.#requireCtx();
    ctx.strokeStyle = this.#resolvePaint(this.#style.strokeColor);
    ctx.lineWidth = this.#style.strokeW;
    ctx.stroke();
  }

  // ── transcript ───────────────────────────────────────────────────
  log(...args: readonly unknown[]): void {
    this.#host.recordLog({ level: "log", message: formatArgs(args) });
  }

  snapshot(label?: string): void {
    this.#host.requestSnapshot(label);
  }
}
