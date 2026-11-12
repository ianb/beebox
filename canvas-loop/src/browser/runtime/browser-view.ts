// The `draw` capability in the browser: a thin facade implementing the same
// `View` contract the CLI uses, delegating every paint call to the shared,
// context-generic Painter (one drawing implementation for both harnesses). It
// wraps a real DOM `CanvasRenderingContext2D`; `log` forwards to the runtime's
// transcript sink and `snapshot` is a no-op (the live canvas is always visible).
import type { ControlBox, CursorKind, TextStyle } from "../../core/tea.js";
import type { SpriteOptions, TextArgs, TextBounds } from "../../core/paint.js";
import type { Sprite } from "../../core/paint.js";
import { ellipseGradient, linearGradient, radialGradient } from "../../core/paint.js";
import { curveCommands } from "../../core/contours.js";
import { offsetPoints, tubePath } from "../../core/shapes.js";
import type { TubeOptions } from "../../core/shapes.js";
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ClipShape, ColorStop, Ctx2D, LinearGradient, PathCommand, RadialGradient, Vec2 } from "../../core/paint.js";
import { Painter } from "../../core/painter/engine.js";
import type { BlendMode, Brush, BrushName, BrushOverrides, Gesture, GroupOptions, Paint, Paper, TextAlign, TextBaseline, View } from "../../core/tea.js";
import { makeDomLayer } from "./layer.js";
import { SketchUsageError } from "../../core/errors.js";

export class BrowserView implements View {
  #painter: Painter;
  #canvas: HTMLCanvasElement;
  #log: (args: readonly unknown[]) => void;
  #names: ReadonlySet<string>;
  #placed = new Map<string, ControlBox>();

  constructor(deps: { ctx: CanvasRenderingContext2D; width: number; height: number; pixelRatio: number; log: (args: readonly unknown[]) => void; params: ReadonlySet<string> }) {
    this.#log = deps.log;
    this.#names = deps.params;
    this.#canvas = deps.ctx.canvas;
    // The DOM context satisfies the structural Ctx2D the Painter uses; only its
    // `fillStyle` union is wider (adds CanvasPattern, never set here), so one
    // boundary cast bridges what structural assignability can't express.
    this.#painter = new Painter({
      // eslint-disable-next-line no-restricted-syntax -- structural-context boundary: CanvasRenderingContext2D is a superset of Ctx2D (wider fillStyle union)
      ctx: deps.ctx as unknown as Ctx2D,
      width: deps.width,
      height: deps.height,
      makeLayer: (size) => makeDomLayer(deps.ctx.canvas.ownerDocument, size),
      pixelRatio: deps.pixelRatio,
      // No `warn`: faint-mark checks read pixels back, which stalls the GPU in a browser every frame.
      // They are an authoring aid for headless transcripts.
    });
  }

  /** Record where param `name`'s input sits this frame; the figure places the real input there. */
  control(name: string, box: ControlBox): void {
    if (!this.#names.has(name)) throw new SketchUsageError({ detail: `control("${name}"): no param named "${name}" is declared` });
    this.#placed.set(name, { ...box });
  }

  /** This frame's control placements; clears them for the next draw. */
  takePlacements(): Map<string, ControlBox> {
    const placed = this.#placed;
    this.#placed = new Map();
    return placed;
  }

  get width(): number {
    return this.#painter.width;
  }
  get height(): number {
    return this.#painter.height;
  }
  get ctx(): SKRSContext2D {
    // The `View.ctx` escape hatch is typed against Skia's context; a sketch that
    // reaches for it uses only the shared 2D methods, present on both. It is the
    // Painter's active context, so raw drawing inside a group lands on the group.
    // eslint-disable-next-line no-restricted-syntax -- escape-hatch boundary: the DOM ctx stands in for SKRSContext2D; sketches touch only the shared subset
    return this.#painter.ctx as unknown as SKRSContext2D;
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
  rect(...args: [number, number, number, number, number?]): void {
    this.#painter.rect(...args);
  }
  textWidth(content: string): number {
    return this.#painter.textWidth(content);
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
    return linearGradient(...args);
  }
  radialGradient(...args: [number, number, number, readonly ColorStop[]]): RadialGradient {
    return radialGradient(...args);
  }
  ellipseGradient(...args: [number, number, number, number, readonly ColorStop[]]): RadialGradient {
    return ellipseGradient(...args);
  }
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    this.#painter.clip(shape, body);
  }
  paperTexture(amount: number): void {
    this.#painter.paperTexture(amount);
  }
  cache(key: string, body: () => void): void {
    this.#painter.cache(key, body);
  }
  sprite(options: SpriteOptions, body: () => void): Sprite {
    return this.#painter.sprite(options, body);
  }
  image(...args: [Sprite, number, number, number?]): void {
    this.#painter.image(...args);
  }
  curve(points: readonly Vec2[], closed?: boolean): void {
    this.#painter.curve(points, closed);
  }
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[] {
    return curveCommands(points, closed ?? false);
  }
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
    return tubePath(points, options);
  }
  offset(points: readonly Vec2[], distance: number): Vec2[] {
    return offsetPoints(points, distance);
  }
  brush(base: BrushName | Brush, overrides?: BrushOverrides): void {
    this.#painter.brush(base, overrides);
  }
  noBrush(): void {
    this.#painter.noBrush();
  }
  gesture(gesture: Gesture): void {
    this.#painter.gesture(gesture);
  }
  paper(paper: Paper): void {
    this.#painter.paper(paper);
  }
  group(options: GroupOptions, body: () => void): void {
    this.#painter.group(options, body);
  }
  blendMode(blend: BlendMode): void {
    this.#painter.blendMode(blend);
  }
  erase(): void {
    this.#painter.erase();
  }
  noErase(): void {
    this.#painter.noErase();
  }
  textFont(family: string): void {
    this.#painter.textFont(family);
  }
  textStyle(style: TextStyle): void {
    this.#painter.textStyle(style);
  }
  debugBox(...args: [string, number, number, number, number]): void {
    this.#painter.debugBox(...args);
  }
  cursor(kind: CursorKind): void {
    if (this.#canvas.style.cursor !== kind) this.#canvas.style.cursor = kind;
  }
  text(...args: TextArgs): TextBounds {
    return this.#painter.text(...args);
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
