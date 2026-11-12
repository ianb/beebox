import type { ControlBox, CursorKind, TextStyle } from "../core/tea.js";
import { controlModels } from "../browser/controls-model.js";
import { SketchUsageError } from "./errors.js";
import type { ControlModel } from "../browser/controls-model.js";
import { recordOf } from "../core/records.js";
import type { Sprite, SpriteOptions } from "../core/tea.js";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, TextArgs, TextBounds, Vec2 } from "../core/paint.js";
import type { Sketch } from "./sketch.js";
import type { BlendMode, Brush, BrushName, BrushOverrides, Gesture, GroupOptions, Paper, TubeOptions, ParamsDecl, ParamValues, TextAlign, TextBaseline, Util, View } from "../core/tea.js";

// ── control stand-ins ────────────────────────────────────────────────
// What a param's over-canvas input looks like in a headless render: a plain
// field showing the current value, so frames and zoom crops show where the
// browser's native input will sit and what it holds.

const NATURAL_HEIGHT = 24;
const DEFAULT_SIZE = 14;

function shown(model: ControlModel): string {
  switch (model.kind) {
    case "number":
      return String(model.value);
    case "select":
      return model.value;
    case "trigger":
      return model.label;
    case "boolean":
      return "";
  }
}

function frame(sketch: Sketch, at: { box: ControlBox; h: number; button: boolean }): void {
  sketch.push();
  sketch.stroke("#767676");
  sketch.strokeWeight(1);
  sketch.fill(at.button ? "#efefef" : "#ffffff");
  sketch.noBrush();
  sketch.noErase();
  sketch.blendMode("normal");
  const { box } = at;
  sketch.rect(box.x + 0.5, box.y + 0.5, box.w - 1, at.h - 1, 3);
  sketch.pop();
}

function checkbox(sketch: Sketch, at: { box: ControlBox; h: number; checked: boolean }): void {
  const side = Math.min(at.h, 16);
  const x = at.box.x + 1;
  const y = at.box.y + (at.h - side) / 2;
  frame(sketch, { box: { x, y, w: side }, h: side, button: false });
  if (!at.checked) return;
  sketch.push();
  sketch.noFill();
  sketch.noBrush();
  sketch.stroke("#111111");
  sketch.strokeWeight(2);
  sketch.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]]);
  sketch.pop();
}

function chevron(sketch: Sketch, at: { x: number; y: number }): void {
  sketch.push();
  sketch.noFill();
  sketch.noBrush();
  sketch.stroke("#444444");
  sketch.strokeWeight(1.5);
  sketch.path([["move", at.x - 4, at.y - 2], ["line", at.x, at.y + 2], ["line", at.x + 4, at.y - 2]]);
  sketch.pop();
}

/** Draw `model`'s stand-in in `box` without touching the sketch's style state. */
function drawStandIn(sketch: Sketch, at: { box: ControlBox; model: ControlModel }): void {
  const { box, model } = at;
  const h = box.h ?? NATURAL_HEIGHT;
  if (model.kind === "boolean") {
    checkbox(sketch, { box, h, checked: model.value });
    return;
  }
  const button = model.kind === "trigger";
  frame(sketch, { box, h, button });
  const select = model.kind === "select";
  const right = select ? 22 : 6;
  if (select) chevron(sketch, { x: box.x + box.w - 12, y: box.y + h / 2 });
  sketch.text(shown(model), { x: box.x + 6, y: box.y, w: box.w - 6 - right, h }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: "middle",
    wrap: false,
    fit: true,
    size: box.size ?? DEFAULT_SIZE,
    font: "sans-serif",
    style: box.bold === true ? "bold" : "normal",
    fill: "#111111",
  });
}

/**
 * The drawing capability handed to `draw`. A thin facade over the shared Sketch
 * engine that exposes only the paint/log/snapshot surface — no `random`, no
 * input state, no parameter store. Capability injection, not runtime checks: the
 * object simply never carries what `draw` isn't allowed to touch.
 */
export class TeaView implements View {
  #sketch: Sketch;
  #decl: ParamsDecl;
  #getParams: () => ParamValues<ParamsDecl>;

  constructor(deps: { sketch: Sketch; decl: ParamsDecl; getParams: () => ParamValues<ParamsDecl> }) {
    this.#sketch = deps.sketch;
    this.#decl = deps.decl;
    this.#getParams = deps.getParams;
  }

  control(name: string, box: ControlBox): void {
    const model = controlModels({ decl: this.#decl, values: this.#getParams() }).find((m) => m.name === name);
    if (model === undefined) {
      throw new SketchUsageError({ detail: `control("${name}"): no param named "${name}" is declared` });
    }
    drawStandIn(this.#sketch, { box, model });
    this.#sketch.debugBox(`control ${name}`, box.x, box.y, box.w, box.h ?? 24);
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
  rect(...args: [number, number, number, number, number?]): void {
    this.#sketch.rect(...args);
  }
  textWidth(content: string): number {
    return this.#sketch.textWidth(content);
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
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    this.#sketch.clip(shape, body);
  }
  ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
    return this.#sketch.ellipseGradient(...args);
  }
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
    return this.#sketch.tube(points, options);
  }
  offset(points: readonly Vec2[], distance: number): Vec2[] {
    return this.#sketch.offset(points, distance);
  }
  paperTexture(amount: number): void {
    this.#sketch.paperTexture(amount);
  }
  cache(key: string, body: () => void): void {
    this.#sketch.cache(key, body);
  }
  sprite(options: SpriteOptions, body: () => void): Sprite {
    return this.#sketch.sprite(options, body);
  }
  image(...args: [Sprite, number, number, number?]): void {
    this.#sketch.image(...args);
  }
  curve(points: readonly Vec2[], closed?: boolean): void {
    this.#sketch.curve(points, closed);
  }
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[] {
    return this.#sketch.curvePath(points, closed);
  }
  brush(base: BrushName | Brush, overrides?: BrushOverrides): void {
    this.#sketch.brush(base, overrides);
  }
  noBrush(): void {
    this.#sketch.noBrush();
  }
  gesture(gesture: Gesture): void {
    this.#sketch.gesture(gesture);
  }
  paper(paper: Paper): void {
    this.#sketch.paper(paper);
  }
  group(options: GroupOptions, body: () => void): void {
    this.#sketch.group(options, body);
  }
  blendMode(blend: BlendMode): void {
    this.#sketch.blendMode(blend);
  }
  erase(): void {
    this.#sketch.erase();
  }
  noErase(): void {
    this.#sketch.noErase();
  }
  textFont(family: string): void {
    this.#sketch.textFont(family);
  }
  textStyle(style: TextStyle): void {
    this.#sketch.textStyle(style);
  }
  debugBox(...args: [string, number, number, number, number]): void {
    this.#sketch.debugBox(...args);
  }
  cursor(kind: CursorKind): void {
    this.#sketch.cursor(kind);
  }
  text(...args: TextArgs): TextBounds {
    return this.#sketch.text(...args);
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

  record<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
    return recordOf(keys, value);
  }

  handled(name: string): void {
    this.#onHandled(name);
  }
}
