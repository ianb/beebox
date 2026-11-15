// The recorder: a draft 2.3 `View` whose calls add nodes to a scene instead of
// painting. Arguments are captured by value at the call. Calls the spike does
// not support yet throw `UnsupportedCallError`, naming the call. Picture
// versions live across frames; in testing mode (`audit`) each asked-for
// version is recorded again and compared, and a difference warns.
import { compositeOp } from "../../core/compose.js";
import { curveCommands } from "../../core/contours.js";
import { ease, tween, tweenPoint } from "../../core/ease.js";
import type { EaseName, Keyframe } from "../../core/ease.js";
import { SketchUsageError, assertUnit } from "../../core/errors.js";
import { formatArgs } from "../../core/format.js";
import { ellipseGradient, linearGradient, radialGradient } from "../../core/paint.js";
import type { ClipShape, ColorStop, LinearGradient, Paint, PathCommand, RadialGradient, TextBounds, TextBox, TextOptions, Vec2 } from "../../core/paint.js";
import type { TextMeasurer } from "../../core/painter/text/measure.js";
import { offsetPoints, tubePath } from "../../core/shapes.js";
import type { TubeOptions } from "../../core/shapes.js";
import type { ControlBox, CursorKind } from "../../core/tea.js";
import type { AtOptions, GroupOptions, Light, Picture, PictureOptions, PlaceOptions, Style, View } from "../../scene-draft/scene-api.js";
import { UnsupportedCallError } from "../errors.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import { versionName } from "../outline.js";
import type { Geom, Mat, PaperSettings, PictureVersion, PixelsVersion, Scene, SceneNode } from "../scene.js";
import { DEFAULT_PAPER, resolvePaper } from "./brush-style.js";
import { PictureHandle, PictureTable, checkPictureOptions, copyDeps, firstDifference, sameData } from "./pictures.js";
import { clipGeoms, copyCommands, copyPaint, copyPoints, resolveGroup, resolveStyle, roundedRect } from "./style.js";
import { debugBoxesOf } from "./debug.js";
import type { DebugBox } from "./debug.js";
import { recordText } from "./text.js";

/** Everything one `draw` produced (draft section 8), and testing-mode warnings. */
export interface FrameRecord {
  readonly scene: Scene;
  readonly logs: readonly string[];
  /** One entry per `snapshot` call, with its label. */
  readonly snapshots: readonly (string | undefined)[];
  readonly debugBoxes: readonly DebugBox[];
  readonly cursor: CursorKind | undefined;
  readonly warnings: readonly string[];
}

function unsupported(call: string, detail?: string): never {
  throw new UnsupportedCallError({ call: `v.${call}`, ...(detail === undefined ? {} : { detail }) });
}

export class SceneRecorder implements View {
  readonly #canvas: { width: number; height: number };
  readonly #text: TextMeasurer | undefined;
  readonly #audit: boolean;
  readonly #table = new PictureTable();
  #open: SceneNode[][] = [];
  #matrix: Mat = IDENTITY;
  #paper: PaperSettings = DEFAULT_PAPER;
  #size: { width: number; height: number };
  /** The picture whose body is recording, for messages; undefined at the top level. */
  #picture: string | undefined;
  #logs: string[] = [];
  #snapshots: (string | undefined)[] = [];
  #warnings: string[] = [];
  #cursor: CursorKind | undefined;

  constructor(size: { width: number; height: number }, options?: { text?: TextMeasurer; audit?: boolean }) {
    this.#canvas = size;
    this.#size = size;
    this.#text = options?.text;
    this.#audit = options?.audit ?? false;
  }

  /** The canvas size, or the picture's inside a picture body (section 5). */
  get width(): number {
    return this.#size.width;
  }
  get height(): number {
    return this.#size.height;
  }

  /** Run `draw` against a fresh scene and return what it recorded. */
  record(draw: (v: View) => void): FrameRecord {
    const root: SceneNode[] = [];
    this.#open = [root];
    this.#matrix = IDENTITY;
    this.#paper = DEFAULT_PAPER;
    this.#size = this.#canvas;
    this.#picture = undefined;
    this.#logs = [];
    this.#snapshots = [];
    this.#warnings = [];
    this.#cursor = undefined;
    this.#table.beginFrame();
    draw(this);
    return { scene: { ...this.#canvas, children: root }, logs: this.#logs, snapshots: this.#snapshots, debugBoxes: debugBoxesOf(root), cursor: this.#cursor, warnings: this.#warnings };
  }

  #add(node: SceneNode): void {
    const top = this.#open.at(-1);
    if (top === undefined) throw new UnsupportedCallError({ call: "drawing outside draw()" });
    top.push(node);
  }
  /** Record `body`'s nodes; the paper it sets ends with it unless `keepPaper`. */
  #inside(body: () => void, keepPaper?: boolean): SceneNode[] {
    const children: SceneNode[] = [];
    const paper = this.#paper;
    this.#open.push(children);
    try {
      body();
    } finally {
      this.#open.pop();
      if (keepPaper !== true) this.#paper = paper;
    }
    return children;
  }
  #shape(call: string, args: { geom: Geom; style: Style }): void {
    this.#add({ kind: "shape", call, geom: args.geom, style: resolveStyle(args.style, { call, paper: this.#paper }) });
  }
  #notInPicture(call: string): void {
    if (this.#picture !== undefined) throw new SketchUsageError({ detail: `v.${call} inside the body of ${this.#picture}: a body runs only when its version records, so ${call} would come and go with the cache (draft section 8)` });
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

  // ── text (section 7) ──
  #measurer(call: string): TextMeasurer {
    if (this.#text === undefined) return unsupported(call, "this recorder was made without the runtime's text measurer");
    return this.#text;
  }
  #layText(...[content, box, options]: [string, TextBox, TextOptions?]): ReturnType<typeof recordText> {
    return recordText(content, { box, options: options ?? {}, measurer: this.#measurer("text"), matrix: this.#matrix, canvas: this.#size });
  }
  text(...args: [string, TextBox, TextOptions?]): TextBounds {
    const { node, bounds } = this.#layText(...args);
    this.#add(node);
    return bounds;
  }
  textBounds(...args: [string, TextBox, TextOptions?]): TextBounds {
    return this.#layText(...args).bounds;
  }
  textWidth(content: string, options?: TextOptions): number {
    return this.#measurer("textWidth").width(content, options);
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
    if (this.#picture !== undefined) throw new SketchUsageError({ detail: `v.toCanvas inside the body of ${this.#picture}: a picture never depends on where it is placed` });
    return apply(this.#matrix, point);
  }

  // ── scopes ──
  at(options: AtOptions, body: () => void): void {
    const matrix = matrixOf(options);
    const outer = this.#matrix;
    this.#matrix = mul(outer, matrix);
    try {
      this.#add({ kind: "at", matrix, children: this.#inside(body, true) });
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
    this.#add({ kind: "clip", shapes, children: this.#inside(body, true) });
  }
  mask(maskBody: () => void, body: () => void): void {
    const mask = this.#inside(maskBody);
    this.#add({ kind: "mask", mask, body: this.#inside(body) });
  }
  /** R9: the paper for brushes drawn after this in the current group, picture or scene. */
  paper(settings: unknown): void {
    this.#paper = resolvePaper(settings);
  }

  // ── pictures (section 5, R7) ──
  /** Record `body` as a picture's nodes: its own coordinates and box, the paper in scope. */
  #recordBody(name: string, a: { size: { width: number; height: number }; body: () => void }): SceneNode[] {
    const saved = { open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture };
    this.#open = [];
    this.#matrix = IDENTITY;
    this.#size = a.size;
    this.#picture = name;
    try {
      return this.#inside(a.body);
    } finally {
      ({ open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture } = saved);
    }
  }
  picture(options: PictureOptions, body: () => void): Picture {
    const { key, width, height } = checkPictureOptions(options, "picture");
    const deps = copyDeps(options.deps, key);
    const paper = this.#paper;
    const found = this.#table.find({ kind: "picture", key, width, height, deps, paper });
    if (found !== undefined && !this.#audit) return new PictureHandle(found);
    const name = versionName({ kind: "picture", key, deps });
    const children = this.#recordBody(name, { size: { width, height }, body });
    if (found?.kind === "picture") {
      const diff = firstDifference({ a: found.children, b: children }, name);
      if (diff !== undefined) this.#warnings.push(`${name} recorded differently with the same deps (a value the body reads is missing from deps, or two drawings share the key): first difference at ${diff}`);
      return new PictureHandle(found);
    }
    const version: PictureVersion = { kind: "picture", key, width, height, deps, paper, children };
    this.#table.add(version);
    return new PictureHandle(version);
  }
  pixels(options: PictureOptions, fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture {
    const { key, width, height } = checkPictureOptions(options, "pixels");
    const deps = copyDeps(options.deps, key);
    const found = this.#table.find({ kind: "pixels", key, width, height, deps });
    if (found !== undefined && !this.#audit) return new PictureHandle(found);
    const image = { data: new Uint8ClampedArray(width * height * 4), width, height };
    fill(image);
    const data = new Uint8Array(image.data);
    const name = versionName({ kind: "pixels", key, deps });
    if (found !== undefined) {
      if (!sameData(found.kind === "pixels" ? found.data : undefined, data)) this.#warnings.push(`${name} filled differently with the same deps`);
      return new PictureHandle(found);
    }
    if (this.#audit && data.every((v, i) => i % 4 !== 3 || v === 0)) this.#warnings.push(`${name}: the fill left every pixel transparent`);
    const version: PixelsVersion = { kind: "pixels", key, width, height, deps, data };
    this.#table.add(version);
    return new PictureHandle(version);
  }
  place(...[picture, x, y, options]: [Picture, number, number, PlaceOptions?]): void {
    if (!(picture instanceof PictureHandle)) throw new SketchUsageError({ detail: "place: the picture must come from v.picture or v.pixels" });
    const o = options ?? {};
    const opacity = o.opacity ?? 1;
    assertUnit(opacity, "place opacity");
    const blend = o.blend ?? "normal";
    compositeOp(blend);
    this.#add({ kind: "place", picture: picture.version, x, y, opacity, blend, erase: o.erase ?? false, material: o.material === undefined ? undefined : structuredClone(o.material) });
  }

  // ── outputs that are not drawing ──
  log(...args: readonly unknown[]): void {
    this.#notInPicture("log");
    this.#logs.push(formatArgs(args));
  }
  snapshot(label?: string): void {
    this.#notInPicture("snapshot");
    this.#snapshots.push(label);
  }
  cursor(kind: CursorKind): void {
    this.#notInPicture("cursor");
    this.#cursor = kind;
  }
  debugBox(...[label, x, y, w, h]: [string, number, number, number, number]): void {
    this.#add({ kind: "debug", label, x, y, w, h });
  }

  // ── not yet ──
  light(_light: Light): void {
    unsupported("light");
  }
  control(_name: string, _box: ControlBox): void {
    this.#notInPicture("control");
    unsupported("control", "control stand-ins come with the browser mount");
  }
  noise(..._args: [number, number?, number?]): number {
    return unsupported("noise");
  }
}
