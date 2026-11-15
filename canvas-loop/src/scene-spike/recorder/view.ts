// The recorder: a draft 2.3 `View` whose calls add nodes to a scene instead of
// painting. Arguments are captured by value at the call. Calls the spike does
// not support yet throw `UnsupportedCallError`, naming the call. Picture
// versions live across frames; in testing mode (`audit`) each asked-for
// version is recorded again and compared, and a difference warns.
import { compositeOp } from "../../core/compose.js";
import { curveCommands } from "../../core/contours.js";
import { SketchUsageError, assertUnit } from "../../core/errors.js";
import { formatArgs } from "../../core/format.js";
import type { ClipShape, Paint, PathCommand, TextBounds, TextBox, TextOptions, Vec2 } from "../../core/paint.js";
import type { TextMeasurer } from "../../core/painter/text/measure.js";
import type { ControlBox, CursorKind } from "../../core/tea.js";
import type { AtOptions, GroupOptions, Light, Picture, PictureOptions, PlaceOptions, Style, View } from "../../scene-draft/scene-api.js";
import { UnsupportedCallError } from "../errors.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import { versionName } from "../outline.js";
import type { Geom, Mat, PaperSettings, PictureVersion, PixelsVersion, SceneNode } from "../scene.js";
import { DEFAULT_PAPER, resolvePaper } from "./brush-style.js";
import { PictureHandle, PictureTable, checkPictureOptions, copyDeps, firstDifference, sameData } from "./pictures.js";
import { clipGeoms, copyCommands, copyPaint, copyPoints, resolveGroup, resolveStyle, roundedRect } from "./style.js";
import { debugBoxesOf } from "./debug.js";
import { keyOf } from "../hash.js";
import { recordText } from "./text.js";
import { PureHelpers } from "./helpers.js";
import { copyMaterial, hasOpenLight, resolveLight } from "./light.js";
import { valueNoise } from "./noise.js";
import { controlBoxes, drawStandIns, placeControl } from "./controls.js";
import type { ControlParams, ControlPlacement } from "./controls.js";
import type { FrameRecord } from "./frame.js";

function unsupported(call: string, detail?: string): never {
  throw new UnsupportedCallError({ call: `v.${call}`, ...(detail === undefined ? {} : { detail }) });
}

export class SceneRecorder extends PureHelpers implements View {
  readonly #canvas: { width: number; height: number };
  readonly #text: TextMeasurer | undefined;
  readonly #audit: boolean;
  readonly #seed: number;
  readonly #params: ControlParams | undefined;
  readonly #table = new PictureTable();
  /** Lit groups open around the current call, outside picture bodies (R8 warnings). */
  #lit = 0;
  /** Inside a mask's artwork, where lights do nothing (R8). */
  #inMask = false;
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
  #controls: ControlPlacement[] = [];

  /** `seed` is the run's seed, which `noise` uses (draft 2.3 section 15); default 0. `params` resolve `control` calls. */
  constructor(size: { width: number; height: number }, options?: { text?: TextMeasurer; audit?: boolean; seed?: number; params?: ControlParams }) {
    super();
    this.#canvas = size;
    this.#size = size;
    this.#text = options?.text;
    this.#audit = options?.audit ?? false;
    this.#seed = options?.seed ?? 0;
    this.#params = options?.params;
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
    this.#controls = [];
    this.#lit = 0;
    this.#inMask = false;
    this.#table.beginFrame();
    draw(this);
    const controls = this.#controls;
    this.#paper = DEFAULT_PAPER;
    // Stand-ins are painted only where text can be measured (headless); the placements are kept either way.
    const standIns = this.#text === undefined ? [] : this.#inside(() => drawStandIns(this, controls));
    return { scene: { ...this.#canvas, children: root }, logs: this.#logs, snapshots: this.#snapshots, debugBoxes: [...debugBoxesOf(root), ...controlBoxes(controls)], cursor: this.#cursor, controls, standIns, warnings: this.#warnings };
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
    const style = resolveStyle(args.style, { call, paper: this.#paper });
    // Structural keys, hashed while recording: what the renderer keeps geometry and expansions under (draft section 6).
    for (const v of [args.geom, style.brush?.brush, style.brush?.gesture]) if (v !== undefined) keyOf(v);
    this.#add({ kind: "shape", call, geom: args.geom, style });
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
    let paper = this.#paper;
    const lit = g.lighting === undefined ? 0 : 1;
    this.#lit += lit;
    try {
      const children = this.#inside(() => {
        body();
        paper = this.#paper;
      });
      this.#add({ kind: "group", ...g, paper, children });
    } finally {
      this.#lit -= lit;
    }
  }
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    const shapes = clipGeoms(shape);
    for (const g of shapes) keyOf(g);
    this.#add({ kind: "clip", shapes, children: this.#inside(body, true) });
  }
  mask(maskBody: () => void, body: () => void): void {
    const outer = this.#inMask;
    this.#inMask = true;
    let mask: SceneNode[];
    try {
      mask = this.#inside(maskBody);
    } finally {
      this.#inMask = outer;
    }
    this.#add({ kind: "mask", mask, body: this.#inside(body) });
  }
  /** R9: the paper for brushes drawn after this in the current group, picture or scene. */
  paper(settings: unknown): void {
    this.#paper = resolvePaper(settings);
  }

  // ── pictures (section 5, R7) ──
  /** Record `body` as a picture's nodes: its own coordinates and box, the paper in scope. */
  #recordBody(name: string, a: { size: { width: number; height: number }; body: () => void }): SceneNode[] {
    const saved = { open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture, inMask: this.#inMask };
    this.#open = [];
    this.#matrix = IDENTITY;
    this.#size = a.size;
    this.#picture = name;
    this.#inMask = false;
    try {
      return this.#inside(a.body);
    } finally {
      ({ open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture, inMask: this.#inMask } = saved);
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
    const v = picture.version;
    if (v.kind === "picture" && hasOpenLight(v.children)) {
      if (this.#inMask) this.#warnings.push(`place ${versionName(v)}: its light is inside a mask's artwork and does nothing (R8)`);
      else if (this.#lit === 0 && this.#picture === undefined) this.#warnings.push(`place ${versionName(v)}: its light is outside any lit group and does nothing (R8)`);
    }
    this.#add({ kind: "place", picture: v, x, y, opacity, blend, erase: o.erase ?? false, material: copyMaterial(o.material, "place") });
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

  /** R8: a light for the nearest enclosing lit group, here or wherever this picture is placed. */
  light(light: Light): void {
    const rec = resolveLight(light);
    if (this.#inMask) this.#warnings.push(`light ${rec.kind} at (${rec.at.join(",")}) inside a mask's artwork does nothing (R8)`);
    else if (this.#lit === 0 && this.#picture === undefined) this.#warnings.push(`light ${rec.kind} at (${rec.at.join(",")}) is outside any lit group and does nothing (R8)`);
    this.#add({ kind: "light", light: rec });
  }
  noise(...[x, y, z]: [number, number?, number?]): number {
    return valueNoise(this.#seed, { x, y: y ?? 0, z: z ?? 0 });
  }

  /** Section 8: a kept placement, in canvas coordinates whatever scope it is called in; headless stand-ins draw above the scene. */
  control(name: string, box: ControlBox): void {
    this.#notInPicture("control");
    this.#controls.push(placeControl(name, box, this.#params));
  }
}
