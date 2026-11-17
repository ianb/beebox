// Lower a scene to jobs by the lowering contract (draft 2.3 section 3):
// shapes become coverage pieces in device pixels, brushed strokes become marks
// or smears (marks.ts), text becomes glyph quads (text.ts), isolating nodes
// and placed pictures become jobs sized to their content grown by their
// effects' reach (R5 bounds, R7), clips become coverage masks in their job.
// A lit group (R8) lowers its body three times: colour, gathering its lights,
// and its two material layers (material.ts), which the light pass shades; a
// fourth for the non-receiving layer when it holds `receivesShadow: false`.
import { BLEND_MODES } from "../core/compose.js";
import type { BlendMode } from "../core/paint.js";
import type { BrushExpander } from "../scene/brush/expand.js";
import type { ColorParser } from "../scene/colors.js";
import { det, invert, mul } from "../scene/mat.js";
import type { Geom, GroupNode, Mat, PaperSettings, PictureVersion, PixelsVersion, PlaceNode, SceneNode, Scene, ShapeNode, TextNode } from "../scene/nodes.js";
import { MAX_CASTER_HEIGHT } from "../scene/nodes.js";
import type { Effects, Material } from "../core/tea.js";
import type { Rgba } from "../scene/colors.js";
import type { LightOut } from "./light.js";
import { lightPlanOf } from "./light.js";
import type { MatMode, MaterialLayer } from "./material.js";
import { LIT_RESULT, bevelOf, casterHeight, materialColor, materialOf, materialPlan } from "./material.js";
import { fxPlanOf } from "./effects.js";
import type { GlyphCache } from "./glyphs.js";
import type { ClipMask, Item, Job, R } from "./jobs.js";
import { EMPTY, cutOf, inter, isEmpty, pad, union } from "./jobs.js";
import type { BrushFrame } from "./marks.js";
import { brushDraw } from "./marks.js";
import type { PaintRec } from "./paint.js";
import { imageRec, paintRec } from "./paint.js";
import { boundsOf, clipBox, fillRings } from "./rings.js";
import { NodePath } from "./node-path.js";
import type { KeptValues, LinShape } from "./geometry-cache.js";
import { linShape, placePiece } from "./geometry-cache.js";
import { linearKey } from "../scene/hash.js";
import type { RasterCache } from "./rasters.js";
import { TILE, tilesOver, wholeLayer } from "./rasters.js";
import { readsSurroundings } from "./picture-reads.js";
import { versionRect } from "../scene/bounds.js";
import { ShapeGeometry } from "./shape-geometry.js";
import { lineQuads } from "./text.js";

/** A version's box as a rect geometry (a self-sizing picture's from its drawing), where its `background` fills. */
const rectOf = (v: PictureVersion | PixelsVersion): Geom => {
  const r = versionRect(v);
  return { kind: "rect", x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
};

interface Here {
  readonly job: Job;
  /** Logical coordinates → canvas device pixels. */
  readonly matrix: Mat;
  readonly clip: ClipMask | null;
  /** Where this job's drawing can still be seen: the canvas grown by every enclosing effect's reach. */
  readonly visible: R;
  /**
   * Where drawing can be seen, not grown by effects: the canvas, or a picture tile's extent (a kept tile must
   * not depend on where the canvas edge falls). A wash reads past it as continuous (`Job.seen`).
   */
  readonly seen: R;
  /** What `background` fills, as device rings: the canvas, or inside a picture its box under the placement. */
  readonly ground: readonly (readonly number[])[];
  /** The transform `background`'s paint uses: the base at the top level, the placement inside a picture. */
  readonly groundMatrix: Mat;
  /** Inside a lit group's colour lowering, where its lights go; undefined outside one and in mask artwork (R8). */
  readonly lights: LightOut[] | undefined;
  /** Inside a lit group's material lowering: which layer, and the materials in force. */
  readonly mat: MatMode | undefined;
}

const modeOf = (b: BlendMode): number => BLEND_MODES.indexOf(b);

export class Lowering {
  readonly #colors: ColorParser;
  readonly #canvas: R;
  readonly #base: Mat;
  readonly #brush: BrushFrame;
  #brushMs = 0;
  readonly #glyphs: GlyphCache;
  readonly #geo: ShapeGeometry;
  readonly #rasters: RasterCache;
  /** The node being lowered, for render errors. */
  readonly #path = new NodePath();
  /** Picture tiles lowered this frame, shared by every placement that needs them. */
  readonly #drawing = new Map<PictureVersion, Map<string, Job>>();
  /** Per picture key: tiles lowered this frame and their CPU milliseconds (`FrameStats.pictures`). */
  readonly #tileCost = new Map<string, { key: string; tiles: number; ms: number }>();

  constructor(options: { colors: ColorParser; width: number; height: number; ratio: number; expander: BrushExpander; glyphs: GlyphCache; kept: KeptValues; rasters: RasterCache; brushLimit: number }) {
    this.#geo = new ShapeGeometry(options.kept);
    this.#rasters = options.rasters;
    this.#colors = options.colors;
    this.#base = [options.ratio, 0, 0, options.ratio, 0, 0];
    this.#canvas = { x0: 0, y0: 0, x1: Math.round(options.width * options.ratio), y1: Math.round(options.height * options.ratio) };
    this.#brush = { expander: options.expander, colors: options.colors, ratio: options.ratio, brushLimit: options.brushLimit };
    this.#glyphs = options.glyphs;
  }

  /** The root job: the canvas. */
  /** CPU milliseconds this lowering spent on brushed strokes: expansion, preparation and placement (`FrameStats.cpu.brush`). */
  get brushMs(): number {
    return this.#brushMs;
  }

  /** Per picture key, the tiles this lowering drew afresh and the CPU milliseconds they took (nested pictures count in each). */
  get pictureTiles(): { key: string; tiles: number; ms: number }[] {
    return [...this.#tileCost.values()];
  }

  lower(scene: Scene): Job {
    const root: Job = { name: "canvas", rect: this.#canvas, items: [], clips: [], fx: undefined };
    const c = this.#canvas;
    const ground = [[c.x0, c.y0, c.x1, c.y0, c.x1, c.y1, c.x0, c.y1]];
    this.#nodes(scene.children, { job: root, matrix: this.#base, clip: null, visible: this.#canvas, seen: this.#canvas, ground, groundMatrix: this.#base, lights: undefined, mat: undefined });
    return root;
  }

  #job(name: string, a: { effects: Effects | undefined; paper?: PaperSettings | undefined; here: Here; body: (inner: Here) => void }): Job {
    const { plan, reach } = fxPlanOf(a.effects, { matrix: a.here.matrix, colors: this.#colors, where: name, ratio: this.#brush.ratio, paper: a.paper });
    const job: Job = { name, rect: EMPTY, items: [], clips: [], fx: a.here.mat === undefined ? plan : materialPlan(plan, a.here.mat.layer), seen: a.here.seen };
    const visible = pad(a.here.visible, reach);
    a.body({ ...a.here, job, clip: null, visible });
    let content = EMPTY;
    for (const it of job.items) if (!it.erase) content = union(content, it.box);
    job.rect = inter(pad(content, reach), visible);
    return job;
  }

  #nodes(nodes: readonly SceneNode[], here: Here): void {
    for (const [i, n] of nodes.entries()) this.#path.inside(n, { index: i + 1, lower: () => this.#node(n, here) });
  }

  #node(n: SceneNode, here: Here): void {
    switch (n.kind) {
      case "shape":
        this.#shapeNode(n, here);
        return;
      case "background": {
        this.#draw({ shape: linShape(here.ground), tx: 0, ty: 0, paint: paintRec(n.paint, { matrix: here.groundMatrix, colors: this.#colors }), mode: 0, erase: false, mat: this.#matColor(here, undefined) }, here);
        return;
      }
      case "at":
        this.#nodes(n.children, { ...here, matrix: mul(here.matrix, n.matrix) });
        return;
      case "group":
        this.#group(n, here);
        return;
      case "clip": {
        const clip = this.#clip(n.shapes, here);
        // Nothing inside a clip that cannot be seen draws; only lights for the lit group are still gathered.
        if (isEmpty(clip.box) && here.lights === undefined) return;
        this.#nodes(n.children, { ...here, clip });
        return;
      }
      case "mask": {
        const body = this.#job("mask body", { effects: undefined, here, body: (inner) => this.#nodes(n.body, inner) });
        // Mask artwork contributes no material: its colour alpha cuts colour and material alike (R8).
        const mask = this.#job("mask", { effects: undefined, here: { ...here, lights: undefined, mat: undefined }, body: (inner) => this.#nodes(n.mask, inner) });
        this.#layer({ job: body, mask, opacity: 1, mode: 0, erase: false }, here);
        return;
      }
      case "text":
        this.#text(n, here);
        return;
      case "place":
        this.#place(n, here);
        return;
      case "light":
        here.lights?.push({ light: n.light, matrix: here.matrix });
        return;
      case "debug":
        return;
    }
  }

  /** R5, or R8 for a lit group: lit by its own lights, and only emissive to an enclosing lit group's materials. */
  #group(n: GroupNode, here: Here): void {
    const name = n.name ?? "group";
    const lighting = n.lighting;
    const lights: LightOut[] = [];
    // A nested lit group, in an enclosing group's material layer: its finished colour alpha, effects
    // included, drawn as emissive, so it is not lit again (R8).
    const nested = lighting !== undefined && here.mat !== undefined;
    const inner = lighting === undefined ? here : nested ? { ...here, lights: undefined, mat: undefined } : { ...here, lights };
    const job = this.#job(name, { effects: n.effects, paper: n.paper, here: inner, body: (i) => this.#nodes(n.children, i) });
    if (lighting !== undefined && here.mat === undefined) {
      const unit = Math.sqrt(Math.abs(det(here.matrix)));
      const tallest = { height: 0 };
      const mat = (layer: MaterialLayer, encodeMax: number): Job => this.#job(`${name} material ${layer}`, { effects: undefined, here: { ...here, visible: job.rect, lights: undefined, mat: { layer, fallback: undefined, unit, tallest, encodeMax } }, body: (i) => this.#nodes(n.children, i) });
      const layer0 = mat(0, MAX_CASTER_HEIGHT);
      let layer1 = mat(1, MAX_CASTER_HEIGHT);
      // A transform can make a caster taller than the encoding holds: encode against the tallest instead.
      const encodeMax = Math.max(MAX_CASTER_HEIGHT, tallest.height);
      if (encodeMax > MAX_CASTER_HEIGHT) layer1 = mat(1, encodeMax);
      // Only a group that holds `receivesShadow: false` pays for the non-receiving layer.
      job.light = { plan: lightPlanOf(lights, { lighting, matrix: here.matrix, colors: this.#colors, ratio: this.#brush.ratio, tallest: tallest.height, encodeMax }), mats: n.nonReceiving ? [layer0, layer1, mat(2, encodeMax)] : [layer0, layer1] };
    }
    const clip = n.clip === undefined ? here.clip : this.#clip(n.clip, here);
    const outer = here.mat;
    const mat = lighting !== undefined && outer !== undefined ? materialColor(LIT_RESULT, { layer: outer.layer }) : undefined;
    this.#layer({ job, mask: undefined, opacity: n.opacity, mode: here.mat === undefined ? modeOf(n.blend) : 0, erase: false, mat }, { ...here, clip });
  }

  /** In a material layer, the colour standing for `material` (or the placement's); undefined when drawing colour. */
  #matColor(here: Here, material: Material | undefined): Rgba | undefined {
    if (here.mat === undefined) return undefined;
    const m = materialOf(material, here.mat);
    if (here.mat.layer !== 1) return materialColor(m, { layer: here.mat.layer });
    // A caster's height is in its own coordinates; the shading measures it in the lit group's.
    const height = (casterHeight(m) * Math.sqrt(Math.abs(det(here.matrix)))) / here.mat.unit;
    here.mat.tallest.height = Math.max(here.mat.tallest.height, height);
    return materialColor(m, { layer: 1, height, encodeMax: here.mat.encodeMax });
  }

  /** R1, or R2 when the style has effects: the fill, then the stroke (plain or brushed). */
  #shapeNode(n: ShapeNode, here: Here): void {
    const s = n.style;
    const m = here.matrix;
    const fill = s.fill === undefined ? undefined : this.#geo.fill(n.geom, m);
    const plain = s.brush === undefined && s.stroke !== undefined && s.weight > 0;
    const stroke = plain ? this.#geo.stroke(n.geom, { style: s, m }) : undefined;
    const t = { tx: m[4], ty: m[5] };
    const mat = this.#matColor(here, s.material);
    // Blends are colour's: material composites normally (R8).
    const inMat = (mode: number): number => (mat === undefined ? mode : 0);
    const both = (at: Here, mode: { mode: number; erase: boolean; brushMode: number }): void => {
      if (s.fill !== undefined && fill !== undefined) this.#draw({ shape: fill, ...t, paint: paintRec(s.fill, { matrix: m, colors: this.#colors }), mode: inMat(mode.mode), erase: mode.erase, mat }, at);
      if (s.stroke !== undefined && stroke !== undefined) this.#draw({ shape: stroke, ...t, paint: paintRec(s.stroke, { matrix: m, colors: this.#colors }), mode: inMat(mode.mode), erase: mode.erase, mat }, at);
      if (s.brush !== undefined) this.#brushed(n, { here: at, mode: inMat(mode.brushMode), erase: mode.erase, mat });
    };
    const bevel = here.mat?.layer === 0 ? bevelOf(materialOf(s.material, here.mat), { x: Math.hypot(m[0], m[1]), y: Math.hypot(m[2], m[3]) }) : undefined;
    if (s.effects === undefined && bevel === undefined) {
      both(here, { mode: modeOf(s.blend), erase: s.erase, brushMode: modeOf(s.brush?.blend ?? "normal") });
      return;
    }
    const job = this.#job(n.call, { effects: s.effects, paper: s.effectsPaper, here, body: (inner) => both(inner, { mode: 0, erase: false, brushMode: modeOf(s.brush?.own ?? "normal") }) });
    if (bevel !== undefined) {
      // The rim's blur reaches past the shape; its normals are kept only under the shape's coverage.
      job.bevel = bevel;
    }
    this.#layer({ job, mask: undefined, opacity: 1, mode: inMat(modeOf(s.blend)), erase: s.erase }, here);
  }

  #brushed(n: ShapeNode, a: { here: Here; mode: number; erase: boolean; mat: Rgba | undefined }): void {
    const { here } = a;
    const t0 = performance.now();
    const d = brushDraw(n, { frame: this.#brush, matrix: here.matrix, visible: here.visible });
    this.#brushMs += performance.now() - t0;
    if (d === undefined) return;
    const box = clipBox(here.clip, d.box);
    if (isEmpty(box)) return;
    // A smudge moves colour, not material (R8).
    if (d.k === "smear") {
      if (a.mat === undefined) here.job.items.push({ ...d, box, mode: 0, erase: false, clip: here.clip });
    }
    else here.job.items.push({ ...d, box, mode: a.mode, erase: a.erase, clip: here.clip, mat: a.mat, node: a.mat === undefined ? n : undefined });
  }

  /** Text: per line, the halo's glyphs and then the fill's, as today's strokeText then fillText. */
  #text(n: TextNode, here: Here): void {
    const mat = this.#matColor(here, undefined);
    const mode = mat === undefined ? modeOf(n.blend) : 0;
    for (const line of n.lines) {
      for (const halo of n.halo === undefined ? [false] : [true, false]) {
        const paint = paintRec(halo && n.halo !== undefined ? n.halo.paint : n.fill, { matrix: here.matrix, colors: this.#colors });
        const quads = lineQuads(n, { line, halo, matrix: here.matrix, glyphs: this.#glyphs, visible: pad(here.visible, 2) });
        if (paint === undefined || quads.length === 0) continue;
        const box = clipBox(here.clip, quads.reduce((b, q) => union(b, q.box), EMPTY));
        if (!isEmpty(box)) here.job.items.push({ k: "glyphs", quads, paint, box, mode, erase: n.erase, clip: here.clip, mat });
      }
    }
  }

  /** R7: replay the picture under the current transform plus (x, y), into its own layer; `background` inside fills its box. */
  #place(n: PlaceNode, here: Here): void {
    // Draft 2.6: every placement's device translation snaps to whole device pixels (rotation and scale unchanged).
    const u = mul(here.matrix, [1, 0, 0, 1, n.x, n.y]);
    const m: Mat = [u[0], u[1], u[2], u[3], Math.round(u[4]), Math.round(u[5])];
    if (invert(m) === undefined) return;
    const v = n.picture;
    // Outside a lit group a picture draws in kept tiles (rasters.ts); inside one its lights and materials join the group's.
    if (v.kind === "picture" && here.lights === undefined && here.mat === undefined) {
      this.#placeTiles(n, { version: v, m, here });
      return;
    }
    const ground = fillRings(rectOf(v), m);
    // R8: the placement's material for the picture's shapes that have none.
    const mat = here.mat === undefined ? undefined : { ...here.mat, fallback: n.material ?? here.mat.fallback };
    const job = this.#job(`place ${v.kind} "${v.key}"`, {
      effects: undefined,
      here: { ...here, matrix: m, ground, groundMatrix: m, mat },
      body: (inner) => {
        if (v.kind === "picture") this.#nodes(v.children, inner);
        else this.#draw({ shape: linShape(fillRings({ kind: "rect", x: 0, y: 0, w: v.width, h: v.height }, m)), tx: 0, ty: 0, paint: imageRec(v, m), mode: 0, erase: false, mat: this.#matColor(inner, undefined) }, inner);
      },
    });
    // A material layer holds material values, not colours: no tint there.
    this.#layer({ job, mask: undefined, opacity: n.opacity, mode: mat === undefined ? modeOf(n.blend) : 0, erase: n.erase, tint: mat === undefined && n.tint !== undefined ? this.#colors(n.tint) : undefined }, here);
  }

  /**
   * R7 through kept tiles (draft 2.6): the placement's device translation
   * snaps to whole device pixels and is taken out; the picture draws in that
   * raster space, cut into the fixed tile grid (or as one layer over its whole
   * extent when it reads its surroundings); each tile seen is a layer moved
   * back by the snapped translation. Tiles are disjoint, so compositing each
   * with the placement's opacity and blend is compositing the one layer. A
   * tile drawn this frame is shared by every placement that needs it.
   */
  #placeTiles(n: PlaceNode, a: { version: PictureVersion; m: Mat; here: Here }): void {
    const { version: v, m, here } = a;
    const ix = Math.round(m[4]);
    const iy = Math.round(m[5]);
    const rm: Mat = [m[0], m[1], m[2], m[3], 0, 0];
    const vis = { x0: here.visible.x0 - ix, y0: here.visible.y0 - iy, x1: here.visible.x1 - ix, y1: here.visible.y1 - iy };
    if (isEmpty(vis)) return;
    const raster = `${linearKey(rm)}|${this.#brush.ratio}`;
    const ground = fillRings(rectOf(v), rm);
    const grid = tilesOver(vis);
    const tint = n.tint === undefined ? undefined : this.#colors(n.tint);
    const tiles = readsSurroundings(v) ? [wholeLayer(grid, { raster, name: v.key })] : grid.map((t) => ({ key: `${raster}|${t.x0 / TILE},${t.y0 / TILE}`, tile: t }));
    for (const { key, tile } of tiles) {
      const job = this.#tileJob(v, { key, tile, rm, ground, here });
      if (isEmpty(job.rect)) continue;
      const shifted = { x0: job.rect.x0 + ix, y0: job.rect.y0 + iy, x1: job.rect.x1 + ix, y1: job.rect.y1 + iy };
      const item: Item = { k: "layer", job, mask: undefined, opacity: n.opacity, mode: modeOf(n.blend), erase: n.erase, shift: [ix, iy], box: clipBox(here.clip, shifted), clip: here.clip, tint };
      if (!isEmpty(item.box)) here.job.items.push(item);
    }
  }

  /** One tile of `v` in raster space: kept, drawn earlier this frame, or lowered now (and kept once drawn). */
  #tileJob(v: PictureVersion, a: { key: string; tile: R; rm: Mat; ground: readonly (readonly number[])[]; here: Here }): Job {
    const { key, tile, rm } = a;
    const kept = this.#rasters.kept(v, key);
    if (kept !== undefined) return { name: `kept tile ${key} of "${v.key}"`, rect: kept.rect, items: [], clips: [], fx: undefined, tex: kept.tex, keptPeaks: kept.peaks };
    const drawing = this.#drawing.get(v)?.get(key);
    if (drawing !== undefined) return drawing;
    const t0 = performance.now();
    const job = this.#job(`place picture "${v.key}" tile ${key}`, { effects: undefined, here: { ...a.here, matrix: rm, visible: tile, seen: tile, ground: a.ground, groundMatrix: rm }, body: (inner) => this.#nodes(v.children, inner) });
    const cost = this.#tileCost.get(v.key) ?? { key: v.key, tiles: 0, ms: 0 };
    this.#tileCost.set(v.key, { key: v.key, tiles: cost.tiles + 1, ms: cost.ms + performance.now() - t0 });
    if (isEmpty(job.rect)) this.#rasters.store(v, { key, rect: EMPTY, tex: undefined });
    else job.keep = { version: v, key };
    const map = this.#drawing.get(v) ?? new Map<string, Job>();
    map.set(key, job);
    this.#drawing.set(v, map);
    return job;
  }

  /** A shape's fill or stroke (linear rings moved by tx, ty), cut to where it can be seen; nothing when it cannot be. */
  #draw(d: { shape: LinShape; tx: number; ty: number; paint: PaintRec | undefined; mode: number; erase: boolean; mat?: Rgba | undefined }, here: Here): void {
    if (d.paint === undefined) return;
    const p = placePiece(d.shape, { tx: d.tx, ty: d.ty, cut: cutOf(here.visible) });
    if (p === undefined) return;
    const box = clipBox(here.clip, p.box);
    if (isEmpty(box)) return;
    here.job.items.push({ k: "shape", piece: p, paint: d.paint, box, mode: d.mode, erase: d.erase, clip: here.clip, mat: d.mat });
  }

  #layer(l: { job: Job; mask: Job | undefined; opacity: number; mode: number; erase: boolean; mat?: Rgba | undefined; tint?: Rgba | undefined }, here: Here): void {
    const area = l.mask === undefined ? l.job.rect : inter(l.job.rect, l.mask.rect);
    const item: Item = { k: "layer", ...l, box: clipBox(here.clip, area), clip: here.clip };
    if (!isEmpty(item.box)) here.job.items.push(item);
  }

  /** A clip in the current job: the union of `shapes` (one shape: its coverage piece), inside any enclosing clip. */
  #clip(shapes: readonly Geom[], here: Here): ClipMask {
    const parent = here.clip;
    const depth = parent === null ? 0 : parent.depth + 1;
    const cov = this.#geo.clip(shapes, { m: here.matrix, cut: cutOf(here.visible) });
    const c: ClipMask = "piece" in cov
      ? { rings: [], piece: cov.piece, parent, depth, box: cov.piece === undefined ? EMPTY : clipBox(parent, cov.piece.box) }
      : { rings: cov.rings, piece: undefined, parent, depth, box: clipBox(parent, boundsOf(cov.rings)) };
    if (!isEmpty(c.box)) here.job.clips.push(c);
    return c;
  }
}
