import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, Vec2 } from "../core/paint.js";
import type { Sketch } from "./sketch.js";
import type { ParamsDecl, ParamValues, TextAlign, TextBaseline, Util, View } from "../core/tea.js";

/**
 * The drawing capability handed to `draw`. A thin facade over the shared Sketch
 * engine that exposes only the paint/log/snapshot surface — no `random`, no
 * input state, no parameter store. Capability injection, not runtime checks: the
 * object simply never carries what `draw` isn't allowed to touch.
 */
export class TeaView implements View {
  #sketch: Sketch;

  constructor(sketch: Sketch) {
    this.#sketch = sketch;
  }

  get width(): number {
    return this.#sketch.width;
  }
  get height(): number {
    return this.#sketch.height;
  }
  get ctx(): SKRSContext2D {
    return this.#sketch.ctx;
  }

  background(paint: Paint): void {
    this.#sketch.background(paint);
  }
  fill(paint: Paint): void {
    this.#sketch.fill(paint);
  }
  noFill(): void {
    this.#sketch.noFill();
  }
  stroke(paint: Paint): void {
    this.#sketch.stroke(paint);
  }
  noStroke(): void {
    this.#sketch.noStroke();
  }
  strokeWeight(weight: number): void {
    this.#sketch.strokeWeight(weight);
  }
  // Rest-tuple params keep max-params (2) satisfied while presenting the
  // p5-style positional signature — same technique as Sketch's own methods.
  rect(...args: [number, number, number, number]): void {
    this.#sketch.rect(...args);
  }
  circle(...args: [number, number, number]): void {
    this.#sketch.circle(...args);
  }
  ellipse(...args: [number, number, number, number]): void {
    this.#sketch.ellipse(...args);
  }
  line(...args: [number, number, number, number]): void {
    this.#sketch.line(...args);
  }
  triangle(...args: [number, number, number, number, number, number]): void {
    this.#sketch.triangle(...args);
  }
  arc(...args: [number, number, number, number, number]): void {
    this.#sketch.arc(...args);
  }
  polygon(points: readonly Vec2[]): void {
    this.#sketch.polygon(points);
  }
  path(commands: readonly PathCommand[]): void {
    this.#sketch.path(commands);
  }
  linearGradient(...args: [number, number, number, number, readonly ColorStop[]]): LinearGradient {
    return this.#sketch.linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return this.#sketch.radialGradient(...args);
  }
  clip(shape: ClipShape, body: () => void): void {
    this.#sketch.clip(shape, body);
  }
  text(...args: [string, number, number]): void {
    this.#sketch.text(...args);
  }
  textSize(size: number): void {
    this.#sketch.textSize(size);
  }
  textAlign(horizontal: TextAlign, vertical?: TextBaseline): void {
    if (vertical === undefined) this.#sketch.textAlign(horizontal);
    else this.#sketch.textAlign(horizontal, vertical);
  }
  push(): void {
    this.#sketch.push();
  }
  pop(): void {
    this.#sketch.pop();
  }
  translate(x: number, y: number): void {
    this.#sketch.translate(x, y);
  }
  rotate(radians: number): void {
    this.#sketch.rotate(radians);
  }
  scale(x: number, y?: number): void {
    if (y === undefined) this.#sketch.scale(x);
    else this.#sketch.scale(x, y);
  }
  log(...args: readonly unknown[]): void {
    this.#sketch.log(...args);
  }
  snapshot(label?: string): void {
    this.#sketch.snapshot(label);
  }
}

/**
 * The capability handed to `init` and `update`: seeded randomness (shared with
 * the run's single PRNG stream, so it stays deterministic and replayable),
 * `log`, and a live view of the resolved parameter values. No drawing surface —
 * `update` cannot paint.
 */
export class TeaUtil<D extends ParamsDecl> implements Util<D> {
  #sketch: Sketch;
  #getParams: () => ParamValues<D>;
  #onHandled: (name: string) => void;

  constructor(deps: { sketch: Sketch; getParams: () => ParamValues<D>; onHandled: (name: string) => void }) {
    this.#sketch = deps.sketch;
    this.#getParams = deps.getParams;
    this.#onHandled = deps.onHandled;
  }

  random(): number;
  random(max: number): number;
  random(min: number, max: number): number;
  random(a?: number, b?: number): number {
    if (a === undefined) return this.#sketch.random();
    if (b === undefined) return this.#sketch.random(a);
    return this.#sketch.random(a, b);
  }

  randomChoice<T>(items: readonly T[]): T {
    return this.#sketch.randomChoice(items);
  }

  get params(): ParamValues<D> {
    return this.#getParams();
  }

  log(...args: readonly unknown[]): void {
    this.#sketch.log(...args);
  }

  handled(name: string): void {
    this.#onHandled(name);
  }
}
