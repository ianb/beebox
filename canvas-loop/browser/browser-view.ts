// The `draw` capability in the browser: a thin facade implementing the same
// `View` contract the CLI uses, delegating every paint call to the shared,
// context-generic Painter (one drawing implementation for both harnesses). It
// wraps a real DOM `CanvasRenderingContext2D`; `log` forwards to the runtime's
// transcript sink and `snapshot` is a no-op (the live canvas is always visible).
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ClipShape, ColorStop, Ctx2D, LinearGradient, PathCommand, RadialGradient, Vec2 } from "../src/core/paint.js";
import { Painter } from "../src/core/painter.js";
import type { Paint, TextAlign, TextBaseline, View } from "../src/core/tea.js";

export class BrowserView implements View {
  #painter: Painter;
  #ctx: CanvasRenderingContext2D;
  #log: (args: readonly unknown[]) => void;

  constructor(deps: { ctx: CanvasRenderingContext2D; width: number; height: number; log: (args: readonly unknown[]) => void }) {
    this.#ctx = deps.ctx;
    this.#log = deps.log;
    // The DOM context satisfies the structural Ctx2D the Painter uses; only its
    // `fillStyle` union is wider (adds CanvasPattern, never set here), so one
    // boundary cast bridges what structural assignability can't express.
    // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: CanvasRenderingContext2D is a superset of Ctx2D (wider fillStyle union)
    this.#painter = new Painter({ ctx: deps.ctx as unknown as Ctx2D, width: deps.width, height: deps.height });
  }

  get width(): number {
    return this.#painter.width;
  }
  get height(): number {
    return this.#painter.height;
  }
  get ctx(): SKRSContext2D {
    // The `View.ctx` escape hatch is typed against Skia's context; a sketch that
    // reaches for it uses only the shared 2D methods, present on both.
    // eslint-disable-next-line no-restricted-syntax -- escape-hatch boundary: the DOM ctx stands in for SKRSContext2D; sketches touch only the shared subset
    return this.#ctx as unknown as SKRSContext2D;
  }

  background(paint: Paint): void {
    this.#painter.background(paint);
  }
  fill(paint: Paint): void {
    this.#painter.fill(paint);
  }
  noFill(): void {
    this.#painter.noFill();
  }
  stroke(paint: Paint): void {
    this.#painter.stroke(paint);
  }
  noStroke(): void {
    this.#painter.noStroke();
  }
  strokeWeight(weight: number): void {
    this.#painter.strokeWeight(weight);
  }
  rect(...args: [number, number, number, number]): void {
    this.#painter.rect(...args);
  }
  circle(...args: [number, number, number]): void {
    this.#painter.circle(...args);
  }
  ellipse(...args: [number, number, number, number]): void {
    this.#painter.ellipse(...args);
  }
  line(...args: [number, number, number, number]): void {
    this.#painter.line(...args);
  }
  triangle(...args: [number, number, number, number, number, number]): void {
    this.#painter.triangle(...args);
  }
  arc(...args: [number, number, number, number, number]): void {
    this.#painter.arc(...args);
  }
  polygon(points: readonly Vec2[]): void {
    this.#painter.polygon(points);
  }
  path(commands: readonly PathCommand[]): void {
    this.#painter.path(commands);
  }
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    return this.#painter.linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return this.#painter.radialGradient(...args);
  }
  clip(shape: ClipShape, body: () => void): void {
    this.#painter.clip(shape, body);
  }
  text(...args: [string, number, number]): void {
    this.#painter.text(...args);
  }
  textSize(size: number): void {
    this.#painter.textSize(size);
  }
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void {
    if (vertical === undefined) this.#painter.textAlign(horizontal);
    else this.#painter.textAlign(horizontal, vertical);
  }
  push(): void {
    this.#painter.push();
  }
  pop(): void {
    this.#painter.pop();
  }
  translate(x: number, y: number): void {
    this.#painter.translate(x, y);
  }
  rotate(radians: number): void {
    this.#painter.rotate(radians);
  }
  scale(x: number, y?: number): void {
    if (y === undefined) this.#painter.scale(x);
    else this.#painter.scale(x, y);
  }
  log(...args: readonly unknown[]): void {
    this.#log(args);
  }
  snapshot(_label?: string): void {
    // No-op: the browser canvas is continuously visible, so there is nothing to
    // capture. Kept to satisfy the View contract shared with the headless tier.
  }
}
