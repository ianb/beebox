// Lower a scene to jobs by the lowering contract (draft 2.3 section 3):
// shapes become coverage pieces in device pixels, brushed strokes become marks
// or smears (marks.ts), text becomes glyph quads (text.ts), isolating nodes
// and placed pictures become jobs sized to their content grown by their
// effects' reach (R5 bounds, R7), clips become coverage masks in their job.
// A lit group (R8) lowers its body three times: colour, gathering its lights,
// and its two material layers (material.ts), which the light pass shades.
import { BLEND_MODES } from "../../core/compose.js";
import type { BlendMode } from "../../core/paint.js";
import type { BrushExpander } from "../brush/expand.js";
import type { ColorParser } from "../colors.js";
import { polylines as flatten } from "../geometry/flatten.js";
import { strokeRings } from "../geometry/stroke.js";
import { invert, maxScale, mul } from "../mat.js";
import type { Geom, GroupNode, Mat, PaperSettings, PlaceNode, SceneNode, Scene, ShapeNode, TextNode } from "../scene.js";
import type { Effects, Material } from "../../scene-draft/scene-api.js";
import type { Rgba } from "../colors.js";
import type { LightOut } from "./light.js";
import { lightPlanOf } from "./light.js";
import type { MatMode } from "./material.js";
import { LIT_RESULT, bevelOf, materialColor, materialOf, materialPlan } from "./material.js";
import { fxPlanOf } from "./effects.js";
import type { GlyphCache } from "./glyphs.js";
import type { ClipMask, Item, Job, R } from "./jobs.js";
import { EMPTY, inter, isEmpty, pad, union } from "./jobs.js";
import type { BrushFrame } from "./marks.js";
import { brushDraw } from "./marks.js";
import type { PaintRec } from "./paint.js";
import { imageRec, paintRec } from "./paint.js";
import { cutRings, orientShape, pieceOf } from "./rings.js";
import { lineQuads } from "./text.js";

interface Here {
  readonly job: Job;
  /** Logical coordinates → canvas device pixels. */
  readonly matrix: Mat;
  readonly clip: ClipMask | null;
  /** Where this job's drawing can still be seen: the canvas grown by every enclosing effect's reach. */
  readonly visible: R;
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

function toDevice(rings: readonly (readonly number[])[], m: Mat): number[][] {
  return rings.map((r) => {
    const o: number[] = [];
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      o.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    }
    return o;
  });
}

function fillRings(g: Geom, m: Mat): number[][] {
  return toDevice(flatten(g, maxScale(m)).map((p) => p.pts).filter((r) => r.length >= 6), m);
}

/** Device-space rings' bounds, as integer pixels. */
function boundsOf(rings: readonly (readonly number[])[]): R {
  return pieceOf(rings.map((r) => [...r]))?.box ?? EMPTY;
}

function clipBox(clip: ClipMask | null, r: R): R {
  let b = r;
  for (let c = clip; c !== null; c = c.parent) b = inter(b, c.box);
  return b;
}

export class Lowering {
  readonly #colors: ColorParser;
  readonly #canvas: R;
  readonly #base: Mat;
  readonly #brush: BrushFrame;
  readonly #glyphs: GlyphCache;

  constructor(options: { colors: ColorParser; width: number; height: number; ratio: number; expander: BrushExpander; glyphs: GlyphCache }) {
    this.#colors = options.colors;
    this.#base = [options.ratio, 0, 0, options.ratio, 0, 0];
    this.#canvas = { x0: 0, y0: 0, x1: Math.round(options.width * options.ratio), y1: Math.round(options.height * options.ratio) };
    this.#brush = { expander: options.expander, colors: options.colors, ratio: options.ratio };
    this.#glyphs = options.glyphs;
  }

  /** The root job: the canvas. */
  lower(scene: Scene): Job {
    const root: Job = { name: "canvas", rect: this.#canvas, items: [], clips: [], fx: undefined };
    const c = this.#canvas;
    const ground = [[c.x0, c.y0, c.x1, c.y0, c.x1, c.y1, c.x0, c.y1]];
    this.#nodes(scene.children, { job: root, matrix: this.#base, clip: null, visible: this.#canvas, ground, groundMatrix: this.#base, lights: undefined, mat: undefined });
    return root;
  }

  #job(name: string, a: { effects: Effects | undefined; paper?: PaperSettings | undefined; here: Here; body: (inner: Here) => void }): Job {
    const { plan, reach } = fxPlanOf(a.effects, { matrix: a.here.matrix, colors: this.#colors, where: name, ratio: this.#brush.ratio, paper: a.paper });
    const job: Job = { name, rect: EMPTY, items: [], clips: [], fx: a.here.mat === undefined ? plan : materialPlan(plan, a.here.mat.layer) };
    const visible = pad(a.here.visible, reach);
    a.body({ ...a.here, job, clip: null, visible });
    let content = EMPTY;
    for (const it of job.items) if (!it.erase) content = union(content, it.box);
    job.rect = inter(pad(content, reach), visible);
    return job;
  }

  #nodes(nodes: readonly SceneNode[], here: Here): void {
    for (const n of nodes) this.#node(n, here);
  }

  #node(n: SceneNode, here: Here): void {
    switch (n.kind) {
      case "shape":
        this.#shapeNode(n, here);
        return;
      case "background": {
        this.#draw({ rings: here.ground, paint: paintRec(n.paint, { matrix: here.groundMatrix, colors: this.#colors }), mode: 0, erase: false, mat: this.#matColor(here, undefined) }, here);
        return;
      }
      case "at":
        this.#nodes(n.children, { ...here, matrix: mul(here.matrix, n.matrix) });
        return;
      case "group":
        this.#group(n, here);
        return;
      case "clip":
        this.#nodes(n.children, { ...here, clip: this.#clip(n.shapes, here) });
        return;
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
      const mat = (layer: 0 | 1): Job => this.#job(`${name} material ${layer}`, { effects: undefined, here: { ...here, visible: job.rect, lights: undefined, mat: { layer, fallback: undefined } }, body: (i) => this.#nodes(n.children, i) });
      job.light = { plan: lightPlanOf(lights, { lighting, matrix: here.matrix, colors: this.#colors, ratio: this.#brush.ratio }), mats: [mat(0), mat(1)] };
    }
    const clip = n.clip === undefined ? here.clip : this.#clip(n.clip, here);
    const outer = here.mat;
    const mat = lighting !== undefined && outer !== undefined ? materialColor(LIT_RESULT, outer.layer) : undefined;
    this.#layer({ job, mask: undefined, opacity: n.opacity, mode: here.mat === undefined ? modeOf(n.blend) : 0, erase: false, mat }, { ...here, clip });
  }

  /** In a material layer, the colour standing for `material` (or the placement's); undefined when drawing colour. */
  #matColor(here: Here, material: Material | undefined): Rgba | undefined {
    return here.mat === undefined ? undefined : materialColor(materialOf(material, here.mat), here.mat.layer);
  }

  /** R1, or R2 when the style has effects: the fill, then the stroke (plain or brushed). */
  #shapeNode(n: ShapeNode, here: Here): void {
    const s = n.style;
    const m = here.matrix;
    const sc = maxScale(m);
    const polys = flatten(n.geom, sc);
    const fill = s.fill === undefined ? [] : toDevice(polys.map((p) => p.pts).filter((r) => r.length >= 6), m);
    const plain = s.brush === undefined && s.stroke !== undefined && s.weight > 0;
    const stroke = plain ? toDevice(polys.flatMap((p) => strokeRings(p, { style: s, scale: sc })), m) : [];
    const mat = this.#matColor(here, s.material);
    // Blends are colour's: material composites normally (R8).
    const inMat = (mode: number): number => (mat === undefined ? mode : 0);
    const both = (at: Here, mode: { mode: number; erase: boolean; brushMode: number }): void => {
      if (s.fill !== undefined) this.#draw({ rings: fill, paint: paintRec(s.fill, { matrix: m, colors: this.#colors }), mode: inMat(mode.mode), erase: mode.erase, mat }, at);
      if (plain) this.#draw({ rings: stroke, paint: paintRec(s.stroke, { matrix: m, colors: this.#colors }), mode: inMat(mode.mode), erase: mode.erase, mat }, at);
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
    const d = brushDraw(n, { frame: this.#brush, matrix: here.matrix, visible: here.visible });
    if (d === undefined) return;
    const box = clipBox(here.clip, d.box);
    if (isEmpty(box)) return;
    // A smudge moves colour, not material (R8).
    if (d.k === "smear") {
      if (a.mat === undefined) here.job.items.push({ ...d, box, mode: 0, erase: false, clip: here.clip });
    }
    else here.job.items.push({ ...d, box, mode: a.mode, erase: a.erase, clip: here.clip, mat: a.mat });
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
    const m = mul(here.matrix, [1, 0, 0, 1, n.x, n.y]);
    if (invert(m) === undefined) return;
    const v = n.picture;
    const ground = fillRings({ kind: "rect", x: 0, y: 0, w: v.width, h: v.height }, m);
    // R8: the placement's material for the picture's shapes that have none.
    const mat = here.mat === undefined ? undefined : { ...here.mat, fallback: n.material ?? here.mat.fallback };
    const job = this.#job(`place ${v.kind} "${v.key}"`, {
      effects: undefined,
      here: { ...here, matrix: m, ground, groundMatrix: m, mat },
      body: (inner) => {
        if (v.kind === "picture") this.#nodes(v.children, inner);
        else this.#draw({ rings: fillRings({ kind: "rect", x: 0, y: 0, w: v.width, h: v.height }, m), paint: imageRec(v, m), mode: 0, erase: false, mat: this.#matColor(inner, undefined) }, inner);
      },
    });
    this.#layer({ job, mask: undefined, opacity: n.opacity, mode: mat === undefined ? modeOf(n.blend) : 0, erase: n.erase }, here);
  }

  /** A shape's fill or stroke, cut to where it can be seen; nothing when it cannot be. */
  #draw(d: { rings: readonly (readonly number[])[]; paint: PaintRec | undefined; mode: number; erase: boolean; mat?: Rgba | undefined }, here: Here): void {
    if (d.paint === undefined) return;
    const p = pieceOf(cutRings(d.rings, pad(here.visible, 2)));
    if (p === undefined) return;
    const box = clipBox(here.clip, p.box);
    if (isEmpty(box)) return;
    here.job.items.push({ k: "shape", piece: p, paint: d.paint, box, mode: d.mode, erase: d.erase, clip: here.clip, mat: d.mat });
  }

  #layer(l: { job: Job; mask: Job | undefined; opacity: number; mode: number; erase: boolean; mat?: Rgba | undefined }, here: Here): void {
    const area = l.mask === undefined ? l.job.rect : inter(l.job.rect, l.mask.rect);
    const item: Item = { k: "layer", ...l, box: clipBox(here.clip, area), clip: here.clip };
    if (!isEmpty(item.box)) here.job.items.push(item);
  }

  /** A clip mask in the current job: the union of `shapes`, inside any enclosing clip. */
  #clip(shapes: readonly Geom[], here: Here): ClipMask {
    const rings = cutRings(shapes.flatMap((g) => orientShape(fillRings(g, here.matrix))), pad(here.visible, 2));
    const c: ClipMask = { rings, parent: here.clip, box: clipBox(here.clip, boundsOf(rings)) };
    here.job.clips.push(c);
    return c;
  }
}
