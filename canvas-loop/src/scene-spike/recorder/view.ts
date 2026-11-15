// The recorder: a draft 2.2 `View` whose calls add nodes to a scene instead of
// painting. Arguments are captured by value at the call. Calls the spike does
// not support yet throw `UnsupportedCallError`, naming the call.
import { curveCommands } from "../../core/contours.js";
import { ease, tween, tweenPoint } from "../../core/ease.js";
import type { EaseName, Keyframe } from "../../core/ease.js";
import { formatArgs } from "../../core/format.js";
import { ellipseGradient, linearGradient, radialGradient } from "../../core/paint.js";
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, TextBounds, TextBox, TextOptions, Vec2 } from "../../core/paint.js";
import { offsetPoints, tubePath } from "../../core/shapes.js";
import type { TubeOptions } from "../../core/shapes.js";
import type { ControlBox, CursorKind } from "../../core/tea.js";
import type { AtOptions, GroupOptions, Light, Picture, PictureOptions, PlaceOptions, Style, View } from "../../scene-draft/scene-api.js";
import { UnsupportedCallError } from "../errors.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import { clipGeoms, copyCommands, copyPaint, copyPoints, resolveGroup, resolveStyle } from "./style.js";
import type { Geom, Mat, Scene, SceneNode } from "../scene.js";

/** A labelled box for `run --outline`, in canvas coordinates. */
export interface DebugBox {
  readonly label: string;
  readonly corners: readonly Vec2[];
}

/** Everything one `draw` produced (draft 2.2 section 8). */
export interface FrameRecord {
  readonly scene: Scene;
  readonly logs: readonly string[];
  /** One entry per `snapshot` call, with its label. */
  readonly snapshots: readonly (string | undefined)[];
  readonly debugBoxes: readonly DebugBox[];
  readonly cursor: CursorKind | undefined;
}

/** A rounded rectangle as path commands (corner arcs as quadratic curves), as today's `roundRect`. */
function roundedRect(b: { x: number; y: number; w: number; h: number; r: number }): PathCommand[] {
  const { x, y, w, h, r } = b;
  return [
    ["move", x + r, y], ["line", x + w - r, y], ["quad", x + w, y, x + w, y + r],
    ["line", x + w, y + h - r], ["quad", x + w, y + h, x + w - r, y + h],
    ["line", x + r, y + h], ["quad", x, y + h, x, y + h - r],
    ["line", x, y + r], ["quad", x, y, x + r, y], ["close"],
  ];
}

function unsupported(call: string, detail?: string): never {
  throw new UnsupportedCallError({ call: `v.${call}`, ...(detail === undefined ? {} : { detail }) });
}

export class SceneRecorder implements View {
  readonly width: number;
  readonly height: number;
  #root: SceneNode[] = [];
  #open: SceneNode[][] = [this.#root];
  #matrix: Mat = IDENTITY;
  #logs: string[] = [];
  #snapshots: (string | undefined)[] = [];
  #debugBoxes: DebugBox[] = [];
  #cursor: CursorKind | undefined;

  constructor(size: { width: number; height: number }) {
    this.width = size.width;
    this.height = size.height;
  }

  /** Run `draw` against a fresh scene and return what it recorded. */
  record(draw: (v: View) => void): FrameRecord {
    this.#root = [];
    this.#open = [this.#root];
    this.#matrix = IDENTITY;
    this.#logs = [];
    this.#snapshots = [];
    this.#debugBoxes = [];
    this.#cursor = undefined;
    draw(this);
    return { scene: { width: this.width, height: this.height, children: this.#root }, logs: this.#logs, snapshots: this.#snapshots, debugBoxes: this.#debugBoxes, cursor: this.#cursor };
  }

  #add(node: SceneNode): void {
    const top = this.#open.at(-1);
    if (top === undefined) throw new UnsupportedCallError({ call: "drawing outside draw()" });
    top.push(node);
  }
  #inside(body: () => void): SceneNode[] {
    const children: SceneNode[] = [];
    this.#open.push(children);
    try {
      body();
    } finally {
      this.#open.pop();
    }
    return children;
  }
  #shape(call: string, args: { geom: Geom; style: Style }): void {
    this.#add({ kind: "shape", call, geom: args.geom, style: resolveStyle(args.style, call) });
  }

  // ── shapes ──
  background(paint: Paint): void {
    this.#add({ kind: "background", paint: copyPaint(paint, "background") });
  }
  rect(...[x, y, w, h, style]: [number, number, number, number, Style]): void {
    this.#shape("rect", { geom: { kind: "rect", x, y, w, h }, style });
  }
  roundRect(...[x, y, w, h, radius, style]: [number, number, number, number, number, Style]): void {
    const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
    this.#shape("roundRect", { geom: { kind: "path", commands: roundedRect({ x, y, w, h, r }) }, style });
  }
  circle(...[x, y, radius, style]: [number, number, number, Style]): void {
    this.#shape("circle", { geom: { kind: "ellipse", x, y, rx: radius, ry: radius }, style });
  }
  ellipse(...[x, y, rx, ry, style]: [number, number, number, number, Style]): void {
    this.#shape("ellipse", { geom: { kind: "ellipse", x, y, rx, ry }, style });
  }
  line(...[x1, y1, x2, y2, style]: [number, number, number, number, Style]): void {
    this.#shape("line", { geom: { kind: "poly", points: [[x1, y1], [x2, y2]], closed: false }, style });
  }
  triangle(...[x1, y1, x2, y2, x3, y3, style]: [number, number, number, number, number, number, Style]): void {
    this.#shape("triangle", { geom: { kind: "poly", points: [[x1, y1], [x2, y2], [x3, y3]], closed: true }, style });
  }
  arc(...[x, y, r, start, end, style]: [number, number, number, number, number, Style]): void {
    this.#shape("arc", { geom: { kind: "arc", x, y, r, start, end }, style });
  }
  polygon(points: readonly Vec2[], style: Style): void {
    this.#shape("polygon", { geom: { kind: "poly", points: copyPoints(points), closed: true }, style });
  }
  path(commands: readonly PathCommand[], style: Style): void {
    this.#shape("path", { geom: { kind: "path", commands: copyCommands(commands) }, style });
  }
  curve(...[points, closed, style]: [readonly Vec2[], boolean, Style]): void {
    this.#shape("curve", { geom: { kind: "path", commands: curveCommands(points, closed) }, style });
  }

  // ── pure helpers ──
  curvePath(points: readonly Vec2[], closed?: boolean): PathCommand[] {
    return curveCommands(points, closed ?? false);
  }
  tube(points: readonly Vec2[], options: TubeOptions): PathCommand[] {
    return tubePath(points, options);
  }
  offset(points: readonly Vec2[], distance: number): Vec2[] {
    return offsetPoints(points, distance);
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
  tween(...args: [readonly Keyframe<number>[], number, EaseName?]): number {
    return tween(...args);
  }
  tweenPoint(...args: [readonly Keyframe<readonly number[]>[], number, EaseName?]): number[] {
    return tweenPoint(...args);
  }
  ease(name: EaseName, u: number): number {
    return ease(name, u);
  }
  toCanvas(point: Vec2): Vec2 {
    return apply(this.#matrix, point);
  }

  // ── scopes ──
  at(options: AtOptions, body: () => void): void {
    const matrix = matrixOf(options);
    const outer = this.#matrix;
    this.#matrix = mul(outer, matrix);
    try {
      this.#add({ kind: "at", matrix, children: this.#inside(body) });
    } finally {
      this.#matrix = outer;
    }
  }
  group(options: GroupOptions, body: () => void): void {
    const g = resolveGroup(options);
    this.#add({ kind: "group", ...g, children: this.#inside(body) });
  }
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    const shapes = clipGeoms(shape);
    this.#add({ kind: "clip", shapes, children: this.#inside(body) });
  }
  mask(maskBody: () => void, body: () => void): void {
    const mask = this.#inside(maskBody);
    this.#add({ kind: "mask", mask, body: this.#inside(body) });
  }

  // ── outputs that are not drawing ──
  log(...args: readonly unknown[]): void {
    this.#logs.push(formatArgs(args));
  }
  snapshot(label?: string): void {
    this.#snapshots.push(label);
  }
  cursor(kind: CursorKind): void {
    this.#cursor = kind;
  }
  debugBox(...[label, x, y, w, h]: [string, number, number, number, number]): void {
    const m = this.#matrix;
    this.#debugBoxes.push({ label, corners: [apply(m, [x, y]), apply(m, [x + w, y]), apply(m, [x + w, y + h]), apply(m, [x, y + h])] });
  }

  // ── not yet ──
  text(..._args: [string, TextBox, TextOptions?]): TextBounds {
    return unsupported("text", "text comes in chunk 3");
  }
  textBounds(..._args: [string, TextBox, TextOptions?]): TextBounds {
    return unsupported("textBounds");
  }
  textWidth(_content: string, _options?: TextOptions): number {
    return unsupported("textWidth");
  }
  picture(_options: PictureOptions, _body: () => void): Picture {
    return unsupported("picture", "pictures come in chunk 3");
  }
  pixels(_options: PictureOptions, _fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture {
    return unsupported("pixels");
  }
  place(..._args: [Picture, number, number, PlaceOptions?]): void {
    unsupported("place");
  }
  light(_light: Light): void {
    unsupported("light");
  }
  paper(_paper: unknown): void {
    unsupported("paper", "paper comes with brushes in chunk 3");
  }
  control(_name: string, _box: ControlBox): void {
    unsupported("control", "control stand-ins need text");
  }
  noise(..._args: [number, number?, number?]): number {
    return unsupported("noise");
  }
}
