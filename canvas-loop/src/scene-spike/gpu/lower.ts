// Lower a scene to jobs by the lowering contract (draft 2.2 section 3):
// shapes become coverage pieces in device pixels, isolating nodes become jobs
// sized to their content grown by their effects' reach (R5 bounds), clips
// become coverage masks in their job.
import { BLEND_MODES } from "../../core/compose.js";
import type { BlendMode, Paint } from "../../core/paint.js";
import { polylines as flatten } from "../geometry/flatten.js";
import { strokeRings } from "../geometry/stroke.js";
import { maxScale, mul } from "../mat.js";
import type { Geom, Mat, SceneNode, Scene, ShapeNode } from "../scene.js";
import type { Effects } from "../../scene-draft/scene-api.js";
import { fxPlanOf } from "./effects.js";
import type { ClipMask, Item, Job, Piece, R } from "./jobs.js";
import { EMPTY, inter, isEmpty, pad, union } from "./jobs.js";
import type { ColorParser } from "../colors.js";
import { paintRec } from "./paint.js";
import { cutRings, orientShape } from "./rings.js";

interface Here {
  readonly job: Job;
  /** Logical coordinates → canvas device pixels. */
  readonly matrix: Mat;
  readonly clip: ClipMask | null;
  /** Where this job's drawing can still be seen: the canvas grown by every enclosing effect's reach. */
  readonly visible: R;
}

const modeOf = (b: BlendMode): number => BLEND_MODES.indexOf(b);

function piece(rings: number[][]): Piece | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (!(x1 > x0 && y1 > y0) || !Number.isFinite(x0 + x1 + y0 + y1)) return undefined;
  return { rings, box: { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) } };
}

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
  return piece(rings.map((r) => [...r]))?.box ?? EMPTY;
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

  constructor(options: { colors: ColorParser; width: number; height: number; ratio: number }) {
    this.#colors = options.colors;
    this.#base = [options.ratio, 0, 0, options.ratio, 0, 0];
    this.#canvas = { x0: 0, y0: 0, x1: Math.round(options.width * options.ratio), y1: Math.round(options.height * options.ratio) };
  }

  /** The root job: the canvas. */
  lower(scene: Scene): Job {
    const root: Job = { name: "canvas", rect: this.#canvas, items: [], clips: [], fx: undefined };
    this.#nodes(scene.children, { job: root, matrix: this.#base, clip: null, visible: this.#canvas });
    return root;
  }

  #job(name: string, a: { effects: Effects | undefined; here: Here; body: (inner: Here) => void }): Job {
    const { plan, reach } = fxPlanOf(a.effects, { matrix: a.here.matrix, colors: this.#colors, where: name });
    const job: Job = { name, rect: EMPTY, items: [], clips: [], fx: plan };
    const visible = pad(a.here.visible, reach);
    a.body({ job, matrix: a.here.matrix, clip: null, visible });
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
        const rings = [[this.#canvas.x0, this.#canvas.y0, this.#canvas.x1, this.#canvas.y0, this.#canvas.x1, this.#canvas.y1, this.#canvas.x0, this.#canvas.y1]];
        this.#draw({ rings, paint: n.paint, matrix: this.#base, mode: 0, erase: false }, here);
        return;
      }
      case "at":
        this.#nodes(n.children, { ...here, matrix: mul(here.matrix, n.matrix) });
        return;
      case "group": {
        const job = this.#job(n.name ?? "group", { effects: n.effects, here, body: (inner) => this.#nodes(n.children, inner) });
        const clip = n.clip === undefined ? here.clip : this.#clip(n.clip, here);
        this.#layer({ job, mask: undefined, opacity: n.opacity, mode: modeOf(n.blend), erase: false }, { ...here, clip });
        return;
      }
      case "clip":
        this.#nodes(n.children, { ...here, clip: this.#clip(n.shapes, here) });
        return;
      case "mask": {
        const body = this.#job("mask body", { effects: undefined, here, body: (inner) => this.#nodes(n.body, inner) });
        const mask = this.#job("mask", { effects: undefined, here, body: (inner) => this.#nodes(n.mask, inner) });
        this.#layer({ job: body, mask, opacity: 1, mode: 0, erase: false }, here);
        return;
      }
    }
  }

  /** R1, or R2 when the style has effects: the fill, then the stroke. */
  #shapeNode(n: ShapeNode, here: Here): void {
    const s = n.style;
    const m = here.matrix;
    const sc = maxScale(m);
    const polys = flatten(n.geom, sc);
    const fill = s.fill === undefined ? [] : toDevice(polys.map((p) => p.pts).filter((r) => r.length >= 6), m);
    const stroke = s.stroke === undefined || s.weight <= 0 ? [] : toDevice(polys.flatMap((p) => strokeRings(p, { style: s, scale: sc })), m);
    const both = (at: Here, mode: { mode: number; erase: boolean }): void => {
      if (s.fill !== undefined) this.#draw({ rings: fill, paint: s.fill, matrix: m, ...mode }, at);
      if (s.stroke !== undefined) this.#draw({ rings: stroke, paint: s.stroke, matrix: m, ...mode }, at);
    };
    if (s.effects === undefined) {
      both(here, { mode: modeOf(s.blend), erase: s.erase });
      return;
    }
    const job = this.#job(n.call, { effects: s.effects, here, body: (inner) => both(inner, { mode: 0, erase: false }) });
    this.#layer({ job, mask: undefined, opacity: 1, mode: modeOf(s.blend), erase: s.erase }, here);
  }

  /** A shape's fill or stroke, cut to where it can be seen; nothing when it cannot be. */
  #draw(d: { rings: readonly (readonly number[])[]; paint: Paint; matrix: Mat; mode: number; erase: boolean }, here: Here): void {
    const p = piece(cutRings(d.rings, pad(here.visible, 2)));
    if (p === undefined) return;
    const box = clipBox(here.clip, p.box);
    if (isEmpty(box)) return;
    const paint = paintRec(d.paint, { matrix: d.matrix, colors: this.#colors });
    if (paint === undefined) return;
    here.job.items.push({ k: "shape", piece: p, paint, box, mode: d.mode, erase: d.erase, clip: here.clip });
  }

  #layer(l: { job: Job; mask: Job | undefined; opacity: number; mode: number; erase: boolean }, here: Here): void {
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
