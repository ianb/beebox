// The p5-like drawing engine, extracted from Sketch so a single implementation
// serves every harness. It is typed against the structural `Ctx2D` subset (see
// paint.ts), so the same code paints onto the headless Skia context (CLI) and a
// browser `CanvasRenderingContext2D` (the HTML playground) — the two concrete
// contexts are each handed in through one boundary cast by their owner.
//
// Painter owns only drawing: style state, transforms, the shape/text/gradient
// primitives, and the data→ctx crossing (via the paint.ts trace/resolve
// helpers). Randomness, time, input, capture, and canvas creation stay with the
// caller (Sketch for the CLI, the browser runtime for the playground).
import type { ClipShape, ColorStop, Ctx2D, Ctx2DGradient, CtxTextAlign, CtxTextBaseline, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "./paint.js";
import { isPathShape, resolveGradient, tracePath, tracePolygon } from "./paint.js";

interface StyleState {
  fillColor: Paint;
  fillEnabled: boolean;
  strokeColor: Paint;
  strokeEnabled: boolean;
  strokeW: number;
  textSize: number;
  textAlignH: CtxTextAlign;
  textAlignV: CtxTextBaseline;
}

/**
 * The shared p5-like drawing surface over a structural `Ctx2D`. Drawing is
 * deterministic: colors are CSS strings or plain-data gradient handles, resolved
 * to ctx gradients only at paint time. The engine mutates the context but holds
 * no time/random/input state.
 */
export class Painter {
  readonly width: number;
  readonly height: number;

  #ctx: Ctx2D;
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

  constructor(options: { ctx: Ctx2D; width: number; height: number }) {
    this.#ctx = options.ctx;
    this.width = options.width;
    this.height = options.height;
  }

  get ctx(): Ctx2D {
    return this.#ctx;
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
  textAlign(horizontal: CtxTextAlign, vertical?: CtxTextBaseline): void {
    this.#style.textAlignH = horizontal;
    if (vertical !== undefined) this.#style.textAlignV = vertical;
  }

  push(): void {
    this.#ctx.save();
    this.#styleStack.push({ ...this.#style });
  }
  /** Restore the last pushed state. Returns false on stack underflow (no matching push). */
  pop(): boolean {
    const restored = this.#styleStack.pop();
    if (restored === undefined) return false;
    this.#ctx.restore();
    this.#style = restored;
    return true;
  }

  // ── transforms ───────────────────────────────────────────────────
  translate(x: number, y: number): void {
    this.#ctx.translate(x, y);
  }
  rotate(radians: number): void {
    this.#ctx.rotate(radians);
  }
  scale(x: number, y?: number): void {
    this.#ctx.scale(x, y ?? x);
  }

  // ── gradients ────────────────────────────────────────────────────
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    const [x1, y1, x2, y2, stops] = args;
    return { kind: "linear-gradient", x1, y1, x2, y2, stops };
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    const [x, y, radius, stops] = args;
    return { kind: "radial-gradient", x1: x, y1: y, r1: 0, x2: x, y2: y, r2: radius, stops };
  }

  #resolvePaint(paint: Paint): string | Ctx2DGradient {
    if (typeof paint === "string") return paint;
    return resolveGradient(this.#ctx, paint);
  }

  // ── drawing ──────────────────────────────────────────────────────
  background(paint: Paint): void {
    const ctx = this.#ctx;
    ctx.save();
    ctx.resetTransform();
    // Resolve after resetTransform so a gradient's coords are canvas-space.
    ctx.fillStyle = this.#resolvePaint(paint);
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  rect(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    this.#ctx.beginPath();
    this.#ctx.rect(x, y, w, h);
    this.#paint();
  }

  circle(...args: [number, number, number]): void {
    const [x, y, diameter] = args;
    this.#ctx.beginPath();
    this.#ctx.arc(x, y, diameter / 2, 0, Math.PI * 2);
    this.#paint();
  }

  ellipse(...args: [number, number, number, number]): void {
    const [x, y, w, h] = args;
    this.#ctx.beginPath();
    this.#ctx.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
    this.#paint();
  }

  line(...args: [number, number, number, number]): void {
    const [x1, y1, x2, y2] = args;
    this.#ctx.beginPath();
    this.#ctx.moveTo(x1, y1);
    this.#ctx.lineTo(x2, y2);
    this.#stroke();
  }

  triangle(...args: [number, number, number, number, number, number]): void {
    const [x1, y1, x2, y2, x3, y3] = args;
    this.#ctx.beginPath();
    this.#ctx.moveTo(x1, y1);
    this.#ctx.lineTo(x2, y2);
    this.#ctx.lineTo(x3, y3);
    this.#ctx.closePath();
    this.#paint();
  }

  arc(...args: [number, number, number, number, number]): void {
    const [x, y, radius, startAngle, endAngle] = args;
    this.#ctx.beginPath();
    this.#ctx.arc(x, y, radius, startAngle, endAngle);
    this.#paint();
  }

  polygon(points: readonly Vec2[]): void {
    tracePolygon(this.#ctx, points);
    this.#paint();
  }

  path(commands: readonly PathCommand[]): void {
    tracePath(this.#ctx, commands);
    this.#paint();
  }

  // Clip to a polygon/path for the duration of `body`, restoring afterward.
  clip(shape: ClipShape, body: () => void): void {
    this.push();
    try {
      const ctx = this.#ctx;
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
    const ctx = this.#ctx;
    ctx.font = `${this.#style.textSize}px sans-serif`;
    ctx.textAlign = this.#style.textAlignH;
    ctx.textBaseline = this.#style.textAlignV;
    if (this.#style.fillEnabled) {
      ctx.fillStyle = this.#resolvePaint(this.#style.fillColor);
      ctx.fillText(content, x, y);
    }
  }

  #paint(): void {
    if (this.#style.fillEnabled) {
      this.#ctx.fillStyle = this.#resolvePaint(this.#style.fillColor);
      this.#ctx.fill();
    }
    this.#stroke();
  }

  #stroke(): void {
    if (!this.#style.strokeEnabled) return;
    this.#ctx.strokeStyle = this.#resolvePaint(this.#style.strokeColor);
    this.#ctx.lineWidth = this.#style.strokeW;
    this.#ctx.stroke();
  }
}
