import type { ControlBox, CursorKind, TextStyle } from "../core/tea.js";
import { controlModels } from "../browser/controls-model.js";
import { SketchUsageError } from "./errors.js";
import type { ControlModel } from "../browser/controls-model.js";
import { recordOf } from "../core/records.js";
import type { Sprite, SpriteOptions } from "../core/tea.js";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { AtOptions, ClipShape, ColorStop, LinearGradient, Paint, PasteOptions, PathCommand, RadialGradient, Style, TextArgs, TextBounds, TextOptions, Vec2 } from "../core/paint.js";
import { resolveBrush } from "../core/brush/presets.js";
import type { Painter } from "../core/painter/engine.js";
import type { Sketch } from "./sketch.js";
import type { BlendMode, Brush, BrushName, BrushOverrides, Gesture, GroupOptions, Paper, TubeOptions, ParamsDecl, ParamValues, TextAlign, TextBaseline, Util, View } from "../core/tea.js";

// ── control stand-ins: a plain field showing the param's value, so headless
// frames show where the browser's native input will sit and what it holds.

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

const FIELD: Style = { fill: "#ffffff", stroke: "#767676", weight: 1 };
const BUTTON: Style = { ...FIELD, fill: "#efefef" };
const MARK: Style = { stroke: "#222222", weight: 1.75 };

/** Draw `model`'s stand-in in `box`; explicit styles, so the sketch's state is untouched. */
function drawStandIn(painter: Painter, at: { box: ControlBox; model: ControlModel }): void {
  const { box, model } = at;
  const h = box.h ?? NATURAL_HEIGHT;
  if (model.kind === "boolean") {
    const side = Math.min(h, 16);
    const x = box.x + 1;
    const y = box.y + (h - side) / 2;
    painter.roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 3, FIELD);
    if (model.value) painter.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]], MARK);
    return;
  }
  const button = model.kind === "trigger";
  painter.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, h - 1, 3, button ? BUTTON : FIELD);
  const select = model.kind === "select";
  const cx = box.x + box.w - 12;
  const cy = box.y + h / 2;
  if (select) painter.path([["move", cx - 4, cy - 2], ["line", cx, cy + 2], ["line", cx + 4, cy - 2]], MARK);
  painter.text(shown(model), { x: box.x + 6, y: box.y, w: box.w - 6 - (select ? 22 : 6), h }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: "middle",
    wrap: false,
    fit: true,
    size: box.size ?? DEFAULT_SIZE,
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
    drawStandIn(this.#sketch.painter, { box, model });
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
  rect(...args: [number, number, number, number, (number | Style)?]): void {
    this.#sketch.painter.rect(...args);
  }
  roundRect(...args: [number, number, number, number, number, Style]): void {
    this.#sketch.painter.roundRect(...args);
  }
  textWidth(content: string, options?: TextOptions): number {
    return this.#sketch.painter.textWidth(content, options);
  }
  circle(...args: [number, number, number, Style?]): void {
    this.#sketch.painter.circle(...args);
  }
  ellipse(...args: [number, number, number, number, Style?]): void {
    this.#sketch.painter.ellipse(...args);
  }
  line(...args: [number, number, number, number, Style?]): void {
    this.#sketch.painter.line(...args);
  }
  triangle(...args: [number, number, number, number, number, number, Style?]): void {
    this.#sketch.painter.triangle(...args);
  }
  arc(...args: [number, number, number, number, number, Style?]): void {
    this.#sketch.painter.arc(...args);
  }
  polygon(points: readonly Vec2[], style?: Style): void {
    this.#sketch.painter.polygon(points, style);
  }
  path(commands: readonly PathCommand[], style?: Style): void {
    this.#sketch.painter.path(commands, style);
  }
  at(options: AtOptions, body: () => void): void {
    this.#sketch.painter.at(options, body);
  }
  brushOf(base: BrushName, overrides: BrushOverrides): Brush {
    return resolveBrush(base, overrides);
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
  cache(...args: [string, () => void, { blend?: BlendMode; erase?: boolean }?]): void {
    this.#sketch.painter.cache(...args);
  }
  sprite(options: SpriteOptions, body: () => void): Sprite {
    return this.#sketch.sprite(options, body);
  }
  image(...args: [Sprite, number, number, (number | PasteOptions)?]): void {
    this.#sketch.painter.image(...args);
  }
  curve(...args: [readonly Vec2[], boolean?, Style?]): void {
    this.#sketch.painter.curve(...args);
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
