// The recorder: a draft 2.3 `View` whose calls add nodes to a scene instead of
// painting. Arguments are captured by value at the call. Calls the recorder does
// not support yet throw `UnsupportedCallError`, naming the call. Checks that
// need a node's ancestors run in the resolve walk (resolve.ts) once `draw`
// returns, or once a picture body records. Picture versions live across
// frames; in testing mode (`audit`) each asked-for version is recorded again
// and compared, and a difference warns. Warnings name the sketch's line (each
// node keeps its call's stack in testing mode) and are given once per run each.
import { curveCommands } from "../../core/contours.js";
import { SketchUsageError } from "../../core/errors.js";
import { formatArgs } from "../../core/format.js";
import type { ClipShape, Paint, PathCommand, TextBounds, TextBox, TextOptions, Vec2 } from "../../core/paint.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { ControlBox, CursorKind } from "../../core/tea.js";
import type { AtOptions, GroupOptions, Light, Picture, PictureOptions, PlaceOptions, Style, View } from "../../core/tea.js";
import { UnsupportedCallError } from "../errors.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import type { ColorParser } from "../colors.js";
import { checkAt, checkColours, checkGeom, checkNumbers, checkPoints } from "./checks.js";
import type { Geom, Mat, PaperSettings, SceneNode, ShapeNode, TextNode } from "../nodes.js";
import { callSite } from "../call-site.js";
import type { CallSite } from "../call-site.js";
import { DEFAULT_PAPER, resolvePaper } from "./brush-style.js";
import { PictureTable, placedVersion } from "./pictures.js";
import { recordPicture, recordPixels } from "./picture-calls.js";
import type { PictureScope } from "./picture-calls.js";
import { RecorderNotes } from "./notes.js";
import type { NoteSink } from "./notes.js";
import { clipGeoms, copyCommands, copyPaint, copyPoints, resolveGroup, resolvePlace, resolveStyle, roundedRect } from "./style.js";
import { debugBoxesOf } from "./debug.js";
import { recordText } from "./text.js";
import type { GlyphMissing } from "./text-checks.js";
import { Audit } from "./audit.js";
import { PureHelpers } from "./helpers.js";
import { holdsNonReceiving, resolveLight } from "./light.js";
import { Resolver } from "./resolve.js";
import type { ResolveContext, TextFacts } from "./resolve.js";
import { valueNoise } from "./noise.js";
import { controlBoxes, drawStandIns, placeControl } from "./controls.js";
import type { ControlParams } from "./controls.js";
import type { FrameOutputs, FrameRecord } from "./frame.js";

export class SceneRecorder extends PureHelpers implements View {
  readonly #canvas: { width: number; height: number };
  readonly #text: TextMeasurer | undefined;
  /** Testing mode's checks (audit.ts); undefined when not testing. */
  readonly #audit: Audit | undefined;
  readonly #seed: number;
  readonly #params: ControlParams | undefined;
  readonly #table = new PictureTable();
  readonly #colors: ColorParser | undefined;
  readonly #notes: RecorderNotes;
  readonly #resolver: Resolver;
  /** Each text node's facts for the walk: kept for `keepInside`, and in testing mode for its checks. */
  readonly #texts = new WeakMap<TextNode, TextFacts>();
  /** Testing mode: the stack of the call that made each node, for the walk's warnings; one map per frame. */
  #sites: WeakMap<SceneNode, CallSite> | undefined;
  #open: SceneNode[][] = [];
  #matrix: Mat = IDENTITY;
  #paper: PaperSettings = DEFAULT_PAPER;
  #size: { width: number; height: number };
  /** The picture whose body is recording, for messages; undefined at the top level. */
  #picture: string | undefined;
  /** The frame's outputs that are not drawing (section 8). */
  #out: FrameOutputs = { logs: [], snapshots: [], cursor: undefined, controls: [] };

  /**
   * `seed` is the run's seed, which `noise` uses (draft 2.3 section 15); default 0. `params` resolve `control` calls.
   * With `colors`, colours are parsed at the call (an unparsable one is an error there); with `fontKnown`, text in a
   * font family the runtime does not have warns; with `glyphMissing`, a character the font has no glyph for warns. With `onNote`, each log, warning and hint is also given to it as it
   * happens, including in a `draw` that then throws.
   */
  constructor(size: { width: number; height: number }, options?: { text?: TextMeasurer; audit?: boolean; seed?: number; params?: ControlParams; colors?: ColorParser; fontKnown?: (family: string) => boolean; glyphMissing?: GlyphMissing; onNote?: NoteSink }) {
    super();
    this.#notes = new RecorderNotes(options?.onNote);
    this.#canvas = size;
    this.#size = size;
    this.#text = options?.text;
    this.#audit = options?.audit === true ? new Audit(size, { glyphMissing: options.glyphMissing, fontKnown: options.fontKnown, warn: (once, a) => this.#notes.warnAt(once, a) }) : undefined;
    this.#seed = options?.seed ?? 0;
    this.#params = options?.params;
    this.#colors = options?.colors;
    this.#resolver = new Resolver({ notes: this.#notes, audit: this.#audit, text: this.#text, texts: this.#texts, sites: () => this.#sites });
  }

  /** The canvas size, or the picture's inside a picture body (section 5). */
  get width(): number {
    return this.#size.width;
  }
  get height(): number {
    return this.#size.height;
  }

  /** After a run (testing mode): drawings off the canvas, or unboxed text crossing its edge, on every frame. */
  readonly offCanvasWarnings = (): string[] => this.#audit?.offCanvas.warnings() ?? [];

  /** Testing mode: where the sketch drew brushed mark `node`, when the faint-mark check judges it (audit.ts). */
  readonly markSite = (node: ShapeNode): CallSite | undefined => this.#audit?.markSite(node);

  /** Forget every picture version, so each body records again (a web font finished loading, draft section 20). */
  readonly forgetPictures = (): void => this.#table.clear();

  /** Run `draw` against a fresh scene and return what it recorded. */
  record(draw: (v: View) => void): FrameRecord {
    const recorded: SceneNode[] = [];
    const out: FrameOutputs = { logs: [], snapshots: [], cursor: undefined, controls: [] };
    ({ open: this.#open, matrix: this.#matrix, paper: this.#paper, size: this.#size, picture: this.#picture, out: this.#out } = { open: [recorded], matrix: IDENTITY, paper: DEFAULT_PAPER, size: this.#canvas, picture: undefined, out });
    this.#sites = this.#audit === undefined ? undefined : new WeakMap();
    this.#table.beginFrame();
    this.#notes.begin();
    this.#audit?.begin();
    let root: readonly SceneNode[];
    let standIns: readonly SceneNode[];
    let notes: { warnings: string[]; hints: string[] };
    const top: ResolveContext = { matrix: IDENTITY, size: this.#canvas, picture: undefined, lit: 0, inMask: false };
    try {
      draw(this);
      root = this.#resolver.resolve(recorded, top);
      this.#audit?.end();
      this.#paper = DEFAULT_PAPER;
      // Stand-ins are painted only where text can be measured (headless); the placements are kept either way.
      standIns = this.#text === undefined ? [] : this.#resolver.resolve(this.#inside(() => drawStandIns(this, out.controls)), top);
    } finally {
      notes = this.#notes.end();
      this.#open = [];
      this.#sites = undefined;
    }
    return { scene: { ...this.#canvas, children: root }, ...out, debugBoxes: [...debugBoxesOf(root), ...controlBoxes(out.controls)], standIns, ...notes };
  }

  #add(node: SceneNode): void {
    this.#notes.live(node.kind === "shape" ? node.call : node.kind);
    if (this.#colors !== undefined) checkColours(node, this.#colors);
    const top = this.#open.at(-1);
    if (top === undefined) throw new UnsupportedCallError({ call: "drawing outside draw()" });
    // Kept for the nodes the walk can warn about or refuse.
    if (this.#sites !== undefined && (node.kind === "shape" || node.kind === "text" || node.kind === "place" || node.kind === "light" || node.kind === "group")) this.#sites.set(node, callSite());
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
    this.#notes.live(call);
    checkGeom(call, args.geom);
    const style = resolveStyle(args.style, { call, paper: this.#paper });
    const node: ShapeNode = { kind: "shape", call, geom: args.geom, style };
    this.#add(node);
  }
  /** An output that is not drawing: only while `draw` runs, and never in a picture body. */
  #notInPicture(call: string): void {
    this.#notes.live(call);
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
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(radius))) checkNumbers("roundRect", { values: { x, y, w, h, radius } });
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
    checkPoints("curve", points);
    this.#shape("curve", { geom: { kind: "path", commands: curveCommands(points, closed) }, style });
  }

  // ── text (section 7) ──
  #measurer(call: string): TextMeasurer {
    if (this.#text === undefined) throw new UnsupportedCallError({ call: `v.${call}`, detail: "this recorder was made without the runtime's text measurer" });
    return this.#text;
  }
  #layText(content: string, at: { box: TextBox; options: TextOptions | undefined; matrix: Mat }): ReturnType<typeof recordText> {
    return recordText(content, { box: at.box, options: at.options ?? {}, measurer: this.#measurer("text"), matrix: at.matrix, canvas: this.#size });
  }
  /** Text laid out where no transform moves it; a `keepInside` node is laid out again by the walk under its transform. */
  text(...[content, box, options]: [string, TextBox, TextOptions?]): TextBounds {
    const { node, bounds } = this.#layText(content, { box, options, matrix: IDENTITY });
    this.#add(node);
    const keepInside = options?.keepInside === true;
    if (keepInside || this.#audit !== undefined) this.#texts.set(node, { bounds, unboxed: box.w === undefined && !keepInside, keep: keepInside ? { box: { ...box }, options: structuredClone({ ...options }) } : undefined });
    // The builder still knows the transform, so a kept-inside label's bounds are where the walk will put it.
    return keepInside ? this.textBounds(content, box, options) : bounds;
  }
  textBounds(...[content, box, options]: [string, TextBox, TextOptions?]): TextBounds {
    return this.#layText(content, { box, options, matrix: this.#matrix }).bounds;
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
    this.#notes.live("at");
    checkAt(options);
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
    this.#notes.live("group");
    const g = resolveGroup(options);
    let paper = this.#paper;
    const children = this.#inside(() => {
      body();
      paper = this.#paper;
    });
    this.#add({ kind: "group", ...g, nonReceiving: g.lighting !== undefined && holdsNonReceiving(children), paper, children });
  }
  clip(shape: ClipShape | readonly ClipShape[], body: () => void): void {
    this.#notes.live("clip");
    this.#add({ kind: "clip", shapes: clipGeoms(shape), children: this.#inside(body, true) });
  }
  mask(maskBody: () => void, body: () => void): void {
    this.#notes.live("mask");
    const mask = this.#inside(maskBody);
    this.#add({ kind: "mask", mask, body: this.#inside(body) });
  }
  /** R9: the paper for brushes drawn after this in the current group, picture or scene. */
  paper(settings: unknown): void {
    this.#notes.live("paper");
    this.#paper = resolvePaper(settings);
  }

  // ── pictures (section 5, R7) ──
  /** Record `body` as a picture's nodes, then resolve them: its own coordinates and box, the paper in scope. */
  #recordBody(name: string, a: { size: { width: number; height: number }; body: () => void }): readonly SceneNode[] {
    const saved = { open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture };
    let recorded: SceneNode[];
    ({ open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture } = { open: [], matrix: IDENTITY, size: a.size, picture: name });
    try {
      recorded = this.#inside(a.body);
    } finally {
      ({ open: this.#open, matrix: this.#matrix, size: this.#size, picture: this.#picture } = saved);
    }
    const ctx: ResolveContext = { matrix: IDENTITY, size: a.size, picture: name, lit: 0, inMask: false };
    return this.#audit?.text.body(() => this.#resolver.resolve(recorded, ctx)) ?? this.#resolver.resolve(recorded, ctx);
  }
  /** What a picture call needs from the recorder; `call` must be made while `draw` runs. */
  #scope(call: string): PictureScope {
    this.#notes.live(call);
    return { table: this.#table, audit: this.#audit !== undefined, frame: this.#notes.frame, paper: this.#paper, recordBody: (name, a) => this.#recordBody(name, a), warn: (once, message) => this.#notes.warn(once, message) };
  }
  picture(options: PictureOptions, body: () => void): Picture {
    return recordPicture(this.#scope("picture"), { options, body });
  }
  pixels(options: PictureOptions, fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture {
    return recordPixels(this.#scope("pixels"), { options, fill });
  }
  place(...[picture, x, y, options]: [Picture, number, number, PlaceOptions?]): void {
    const v = placedVersion(picture, this.#notes.frame);
    if (!(Number.isFinite(x) && Number.isFinite(y))) checkNumbers("place", { values: { x, y } });
    this.#add({ kind: "place", picture: v, x, y, ...resolvePlace(options) });
  }

  // ── outputs that are not drawing ──
  log(...args: readonly unknown[]): void {
    this.#notInPicture("log");
    this.#out.logs.push(this.#notes.log(formatArgs(args)));
  }
  snapshot(label?: string): void {
    this.#notInPicture("snapshot");
    this.#out.snapshots.push(label);
  }
  cursor(kind: CursorKind): void {
    this.#notInPicture("cursor");
    this.#out.cursor = kind;
  }
  debugBox(...[label, x, y, w, h]: [string, number, number, number, number]): void {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h))) checkNumbers("debugBox", { values: { x, y, w, h } });
    this.#add({ kind: "debug", label, x, y, w, h });
  }

  /** R8: a light for the nearest enclosing lit group, here or wherever this picture is placed. */
  light(light: Light): void {
    this.#add({ kind: "light", light: resolveLight(light) });
  }
  noise(...[x, y, z]: [number, number?, number?]): number {
    return valueNoise(this.#seed, { x, y: y ?? 0, z: z ?? 0 });
  }

  /** Section 8: a kept placement, in canvas coordinates whatever scope it is called in; headless stand-ins draw above the scene. */
  control(name: string, box: ControlBox): void {
    this.#notInPicture("control");
    this.#out.controls.push(placeControl(name, box, this.#params));
  }
}
