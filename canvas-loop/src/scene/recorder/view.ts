// The recorder: a draft 2.11 `View` whose drawing calls return nodes, and
// whose scopes take their children as values; `draw` returns the frame's
// drawing. Arguments are captured by value at the call, and a scope copies its
// children into a list it owns. Each node is stamped with its frame; a node
// from an earlier frame is refused. Checks that need a node's ancestors (its
// transform, paper, lit groups) run in the resolve walk (resolve.ts) once
// `draw` returns, or once a picture body records. Picture versions live across
// frames; in testing mode (`audit`) each asked-for version is recorded again
// and compared, and a difference warns. Warnings name the sketch's line (each
// node keeps its call's stack in testing mode) and are given once per run each;
// testing mode also warns of a node made and never returned.
import { curveCommands } from "../../core/contours.js";
import { SketchUsageError } from "../../core/errors.js";
import { formatArgs } from "../../core/format.js";
import { MADE_IN } from "../../core/paint.js";
import type { ClipShape, DrawingNode, Paint, PathCommand, TextBounds, TextBox, TextOptions, Vec2 } from "../../core/paint.js";
import type { TextMeasurer } from "../../core/text/measure.js";
import type { ControlBox, CursorKind } from "../../core/tea.js";
import type { AtOptions, GroupOptions, Light, Paper, Picture, PictureOptions, PlaceOptions, Style, View } from "../../core/tea.js";
import { RemovedCallError, STATEMENT_DRAW, UnsupportedCallError } from "../errors.js";
import { IDENTITY, apply, matrixOf, mul } from "../mat.js";
import type { ColorParser } from "../colors.js";
import { checkAt, checkColours, checkGeom, checkNumbers, checkPoints } from "./checks.js";
import type { Geom, PaperSettings, SceneNode, ShapeNode, TextNode } from "../nodes.js";
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
import { Children } from "./children.js";

/** Testing mode warns of at most this many drawings made and not returned in one frame. */
const UNRETURNED_PER_FRAME = 8;

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
  /** The paper of each `v.paper` scope: an identity `at` node the walk replaces with its children. */
  readonly #papers = new WeakMap<SceneNode, PaperSettings>();
  readonly #children: Children;
  /** Testing mode: the stack of the call that made each node, for the walk's warnings; one map per frame. */
  #sites: WeakMap<SceneNode, CallSite> | undefined;
  /** Testing mode: the nodes made this frame and not yet put in a scope, a picture body or the root, with their call. */
  #made: Map<SceneNode, string> | undefined;
  /** How many testing-mode re-records of kept pictures are running: their nodes are not counted as made, but may still take nodes that were. */
  #again = 0;
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
    this.#children = new Children({ frame: () => this.#notes.frame, taken: (node) => this.#made?.delete(node) });
    this.#resolver = new Resolver({ notes: this.#notes, audit: this.#audit, text: this.#text, texts: this.#texts, papers: this.#papers, sites: () => this.#sites });
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

  /** Run `draw`, resolve the drawing it returns, and return the frame. A `draw` that returns `undefined` is the retired statement form. */
  record(draw: (v: View) => unknown): FrameRecord {
    const out: FrameOutputs = { logs: [], snapshots: [], cursor: undefined, controls: [] };
    ({ size: this.#size, picture: this.#picture, out: this.#out } = { size: this.#canvas, picture: undefined, out });
    this.#sites = this.#audit === undefined ? undefined : new WeakMap();
    this.#made = this.#audit === undefined ? undefined : new Map();
    this.#again = 0;
    this.#table.beginFrame();
    this.#notes.begin();
    this.#audit?.begin();
    let root: readonly SceneNode[];
    let standIns: readonly SceneNode[];
    let notes: { warnings: string[]; hints: string[] };
    const top: ResolveContext = { matrix: IDENTITY, size: this.#canvas, picture: undefined, lit: 0, inMask: false, paper: DEFAULT_PAPER };
    try {
      const drawn = draw(this);
      if (drawn === undefined) throw new RemovedCallError(STATEMENT_DRAW);
      root = this.#resolver.resolve(this.#children.list("draw", drawn), top);
      this.#warnUnreturned();
      this.#audit?.end();
      // Stand-ins are painted only where text can be measured (headless); the placements are kept either way.
      standIns = this.#text === undefined ? [] : this.#resolver.resolve(this.#children.list("stand-ins", drawStandIns(this, out.controls)), top);
    } finally {
      notes = this.#notes.end();
      this.#sites = undefined;
      this.#made = undefined;
    }
    return { scene: { ...this.#canvas, children: root }, ...out, debugBoxes: [...debugBoxesOf(root), ...controlBoxes(out.controls)], standIns, ...notes };
  }

  /** Testing mode: one warning per line for nodes made this frame that no scope, picture body or `draw` returned. */
  #warnUnreturned(): void {
    const made = this.#made;
    if (made === undefined || made.size === 0) return;
    let given = 0;
    for (const [node, call] of made) {
      const line = this.#sites?.get(node)?.line;
      // A line warned before (this frame or an earlier one) gives nothing and does not count.
      if (this.#notes.warnAt(`unreturned ${call}`, { message: `v.${call} made a drawing that was not returned; put it in the list draw returns, or in a scope's children`, line })) given++;
      if (given === UNRETURNED_PER_FRAME) break;
    }
  }

  /** `node`, stamped with this frame, its colours checked, and in testing mode its call site kept and it counted as made. */
  #stamp<N extends SceneNode>(node: N, call: string): N & DrawingNode {
    if (this.#colors !== undefined) checkColours(node, this.#colors);
    const made = Object.assign(node, { [MADE_IN]: this.#notes.frame });
    this.#sites?.set(made, callSite());
    if (this.#again === 0) this.#made?.set(made, call);
    return made;
  }
  #shape(call: string, args: { geom: Geom; style: Style }): ShapeNode & DrawingNode {
    this.#notes.live(call);
    checkGeom(call, args.geom);
    const style = resolveStyle(args.style, { call, paper: DEFAULT_PAPER });
    return this.#stamp({ kind: "shape", call, geom: args.geom, style }, call);
  }
  /** An output that is not drawing: only while `draw` runs, and never in a picture body. */
  #notInPicture(call: string): void {
    this.#notes.live(call);
    if (this.#picture !== undefined) throw new SketchUsageError({ detail: `v.${call} inside the body of ${this.#picture}: a body runs only when its version records, so ${call} would come and go with the cache (draft section 8)` });
  }

  // ── shapes ──
  background(paint: Paint): DrawingNode {
    this.#notes.live("background");
    return this.#stamp({ kind: "background", paint: copyPaint(paint, "background") }, "background");
  }
  rect(...[x, y, w, h, style]: [number, number, number, number, Style]): DrawingNode {
    return this.#shape("rect", { geom: { kind: "rect", x, y, w, h }, style });
  }
  roundRect(...[x, y, w, h, radius, style]: [number, number, number, number, number, Style]): DrawingNode {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h) && Number.isFinite(radius))) checkNumbers("roundRect", { values: { x, y, w, h, radius } });
    const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
    return this.#shape("roundRect", { geom: { kind: "path", commands: roundedRect({ x, y, w, h, r }) }, style });
  }
  circle(...[x, y, radius, style]: [number, number, number, Style]): DrawingNode {
    return this.#shape("circle", { geom: { kind: "ellipse", x, y, rx: radius, ry: radius }, style });
  }
  ellipse(...[x, y, rx, ry, style]: [number, number, number, number, Style]): DrawingNode {
    return this.#shape("ellipse", { geom: { kind: "ellipse", x, y, rx, ry }, style });
  }
  line(...[x1, y1, x2, y2, style]: [number, number, number, number, Style]): DrawingNode {
    return this.#shape("line", { geom: { kind: "poly", points: [[x1, y1], [x2, y2]], closed: false }, style });
  }
  triangle(...[x1, y1, x2, y2, x3, y3, style]: [number, number, number, number, number, number, Style]): DrawingNode {
    return this.#shape("triangle", { geom: { kind: "poly", points: [[x1, y1], [x2, y2], [x3, y3]], closed: true }, style });
  }
  arc(...[x, y, r, start, end, style]: [number, number, number, number, number, Style]): DrawingNode {
    return this.#shape("arc", { geom: { kind: "arc", x, y, r, start, end }, style });
  }
  polygon(points: readonly Vec2[], style: Style): DrawingNode {
    return this.#shape("polygon", { geom: { kind: "poly", points: copyPoints(points), closed: true }, style });
  }
  path(commands: readonly PathCommand[], style: Style): DrawingNode {
    return this.#shape("path", { geom: { kind: "path", commands: copyCommands(commands) }, style });
  }
  curve(...[points, closed, style]: [readonly Vec2[], boolean, Style]): DrawingNode {
    checkPoints("curve", points);
    return this.#shape("curve", { geom: { kind: "path", commands: curveCommands(points, closed) }, style });
  }

  // ── text (section 7) ──
  #measurer(call: string): TextMeasurer {
    if (this.#text === undefined) throw new UnsupportedCallError({ call: `v.${call}`, detail: "this recorder was made without the runtime's text measurer" });
    return this.#text;
  }
  /** `content` laid out where no transform moves it, kept inside the canvas or the picture's box. */
  #layText(content: string, at: { box: TextBox; options: TextOptions | undefined }): ReturnType<typeof recordText> {
    return recordText(content, { box: at.box, options: at.options ?? {}, measurer: this.#measurer("text"), matrix: IDENTITY, canvas: this.#size });
  }
  /** Text laid out where no transform moves it; a `keepInside` node is laid out again by the walk under its transform. */
  text(...[content, box, options]: [string, TextBox, TextOptions?]): DrawingNode {
    this.#notes.live("text");
    const { node, bounds } = this.#layText(content, { box, options });
    const made = this.#stamp(node, "text");
    const keepInside = options?.keepInside === true;
    if (keepInside || this.#audit !== undefined) this.#texts.set(made, { bounds, unboxed: box.w === undefined && !keepInside, overlay: options?.overlay === true, keep: keepInside ? { box: { ...box }, options: structuredClone({ ...options }) } : undefined });
    return made;
  }
  textBounds(...[content, box, options]: [string, TextBox, TextOptions?]): TextBounds {
    return this.#layText(content, { box, options }).bounds;
  }
  textWidth(content: string, options?: TextOptions): number {
    return this.#measurer("textWidth").width(content, options);
  }

  /** A pure helper: `point` under each scope's transform, innermost first, as the walk composes them. */
  toCanvas(point: Vec2, scopes: readonly AtOptions[]): Vec2 {
    if (!Array.isArray(scopes)) throw new SketchUsageError({ detail: "toCanvas(point, scopes): list the at options the point is inside, outermost first, e.g. v.toCanvas([0, 33], [{ translate: [x, y] }, { rotate: a }])" });
    let matrix = IDENTITY;
    for (const options of scopes) {
      checkAt(options);
      matrix = mul(matrix, matrixOf(options));
    }
    return apply(matrix, point);
  }

  // ── scopes ──
  at(options: AtOptions, children: unknown): DrawingNode {
    this.#notes.live("at");
    const kids = this.#children.list("at", children);
    checkAt(options);
    return this.#stamp({ kind: "at", matrix: matrixOf(options), children: kids }, "at");
  }
  group(options: GroupOptions, children: unknown): DrawingNode {
    this.#notes.live("group");
    const kids = this.#children.list("group", children);
    const g = resolveGroup(options);
    return this.#stamp({ kind: "group", ...g, nonReceiving: g.lighting !== undefined && holdsNonReceiving(kids), paper: DEFAULT_PAPER, children: kids }, "group");
  }
  clip(shape: ClipShape | readonly ClipShape[], children: unknown): DrawingNode {
    this.#notes.live("clip");
    const kids = this.#children.list("clip", children);
    return this.#stamp({ kind: "clip", shapes: clipGeoms(shape), children: kids }, "clip");
  }
  mask(maskArt: unknown, children: unknown): DrawingNode {
    this.#notes.live("mask");
    const mask = this.#children.list("mask", maskArt);
    return this.#stamp({ kind: "mask", mask, body: this.#children.list("mask", children) }, "mask");
  }
  /** R9 (draft 2.11): the paper for every brushed stroke and effect in `children`. */
  paper(...args: [Paper, unknown] | [Paper]): DrawingNode {
    this.#notes.live("paper");
    if (args.length === 1) throw new RemovedCallError({ call: "v.paper(settings) as a statement", replacement: "v.paper(settings, children) sets the paper for the drawing it holds" });
    const [settings, children] = args;
    const kids = this.#children.list("paper", children);
    const node = this.#stamp({ kind: "at", matrix: IDENTITY, children: kids }, "paper");
    this.#papers.set(node, resolvePaper(settings));
    return node;
  }

  // ── pictures (section 5, R7) ──
  /** Record `body` as a picture's nodes, then resolve them: its own coordinates, box and paper. A re-record (testing mode) counts no node as made. */
  #recordBody(name: string, a: { size: { width: number; height: number }; paper: PaperSettings; body: () => unknown; again: boolean }): readonly SceneNode[] {
    const saved = { size: this.#size, picture: this.#picture };
    let recorded: readonly SceneNode[];
    ({ size: this.#size, picture: this.#picture } = { size: a.size, picture: name });
    if (a.again) this.#again++;
    try {
      recorded = this.#children.list(`the body of ${name}`, a.body());
    } finally {
      ({ size: this.#size, picture: this.#picture } = saved);
      if (a.again) this.#again--;
    }
    const ctx: ResolveContext = { matrix: IDENTITY, size: a.size, picture: name, lit: 0, inMask: false, paper: a.paper };
    return this.#audit?.text.body(() => this.#resolver.resolve(recorded, ctx)) ?? this.#resolver.resolve(recorded, ctx);
  }
  /** What a picture call needs from the recorder; `call` must be made while `draw` runs. */
  #scope(call: string): PictureScope {
    this.#notes.live(call);
    return { table: this.#table, audit: this.#audit !== undefined, frame: this.#notes.frame, recordBody: (name, a) => this.#recordBody(name, a), warn: (once, message) => this.#notes.warn(once, message) };
  }
  picture(options: PictureOptions, body: () => unknown): Picture {
    return recordPicture(this.#scope("picture"), { options, body });
  }
  pixels(options: PictureOptions, fill: (image: { data: Uint8ClampedArray; width: number; height: number }) => void): Picture {
    return recordPixels(this.#scope("pixels"), { options, fill });
  }
  place(...[picture, x, y, options]: [Picture, number, number, PlaceOptions?]): DrawingNode {
    this.#notes.live("place");
    const v = placedVersion(picture, this.#notes.frame);
    if (!(Number.isFinite(x) && Number.isFinite(y))) checkNumbers("place", { values: { x, y } });
    return this.#stamp({ kind: "place", picture: v, x, y, ...resolvePlace(options) }, "place");
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
  debugBox(...[label, x, y, w, h]: [string, number, number, number, number]): DrawingNode {
    this.#notes.live("debugBox");
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h))) checkNumbers("debugBox", { values: { x, y, w, h } });
    return this.#stamp({ kind: "debug", label, x, y, w, h }, "debugBox");
  }

  /** R8: a light for the nearest enclosing lit group, here or wherever this picture is placed. */
  light(light: Light): DrawingNode {
    this.#notes.live("light");
    return this.#stamp({ kind: "light", light: resolveLight(light) }, "light");
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
