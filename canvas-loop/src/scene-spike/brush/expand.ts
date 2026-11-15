// The shared CPU step for brushed strokes (draft section 9): a stroke becomes
// dabs, ink outlines or bristle runs by canvas-loop's own sampling and kind
// painters (core/brush), recorded instead of rasterised.
//
// Expansion runs in a "brush space" that depends only on the stroke's data and
// the scale of its transform, never on the pixel ratio or the translation
// (draft section 4, decision 7). The logical linear transform L splits as
// L = q·B with q orthogonal: under a rotation with uniform scale, B is that
// scale and q the rotation; otherwise B = L (the tip stays round under a
// non-uniform scale, width × √|det|). The seed hashes the stroke's geometry
// as passed to the call (not its flattening, which follows the scale), or is
// `gesture.seed`. Expanded strokes are kept while
// they are asked for (draft section 6); `stats` counts hits.
import type { Contour } from "../../core/contours.js";
import { SketchUsageError } from "../../core/errors.js";
import type { Paint } from "../../core/paint.js";
import { hashNumbers } from "../../core/brush/random.js";
import { BLACK, jitterOf, jitteredInk } from "../../core/brush/render/ink.js";
import { paintBristle, paintInk, paintStamp } from "../../core/brush/render/kinds.js";
import { shapeSamples } from "../../core/brush/render/mark/render.js";
import type { ColorParser } from "../colors.js";
import { IDENTITY, applyLinear, det } from "../mat.js";
import type { BrushStroke, Geom, Mat } from "../scene.js";
import { geomContours } from "./contours.js";
import { keyOf, linearKey } from "../hash.js";
import { RecordingCtx, SoftDabImage } from "./record-ctx.js";
import type { Dab, Run } from "./record-ctx.js";

export type { Dab, Run };

/** Dabs, ink outlines (flat rings) and bristle runs, in brush space. `tint` is the paint's alpha when each dab carries its own colour. */
export interface MarkSet {
  readonly kind: "marks";
  readonly dabs: readonly Dab[];
  readonly polys: readonly (readonly number[])[];
  readonly runs: readonly Run[];
  readonly tint: number | undefined;
}
/** A smudge or wet stroke: its dabs per contour, in brush space, and its width there. */
export interface SmearSet {
  readonly kind: "smear";
  readonly contours: readonly (readonly { x: number; y: number; r: number; a: number }[])[];
  readonly width: number;
}
export interface Expanded {
  readonly set: MarkSet | SmearSet;
  /** What the expansion is kept under: equal keys, equal expansions. */
  readonly key: string;
  /** Brush space → the stroke's logical coordinates (linear part only; orthogonal). */
  readonly q: Mat;
}

export interface ExpandRequest {
  readonly geom: Geom;
  readonly weight: number;
  readonly stroke: BrushStroke;
  readonly paint: Paint;
  /** The logical transform of the call (no pixel ratio); only its linear part matters. */
  readonly linear: Mat;
  readonly colors: ColorParser;
}

const SOFT_DAB = new SoftDabImage();

/** L = q·B, q orthogonal (see the header). */
function brushSpace(m: Mat): { b: Mat; q: Mat } {
  const [a, b, c, d] = m;
  const p = a * a + b * b;
  const q = c * c + d * d;
  const tol = 1e-9 * Math.max(p, q);
  if (p > 0 && Math.abs(p - q) <= tol && Math.abs(a * c + b * d) <= tol) {
    const s = Math.sqrt(p);
    return { b: [s, 0, 0, s, 0, 0], q: [a / s, b / s, c / s, d / s, 0, 0] };
  }
  return { b: [a, b, c, d, 0, 0], q: IDENTITY };
}

/** The numbers the call passed, in its own coordinates: what a stroke's seed hashes (section 4), independent of flattening. */
function geomNumbers(g: Geom): number[] {
  switch (g.kind) {
    case "rect":
      return [1, g.x, g.y, g.w, g.h];
    case "ellipse":
      return [2, g.x, g.y, g.rx, g.ry];
    case "arc":
      return [3, g.x, g.y, g.r, g.start, g.end];
    case "poly":
      return [4, g.closed ? 1 : 0, ...g.points.flat()];
    case "path":
      return [5, ...g.commands.flatMap((c) => c.slice(1).filter((v) => typeof v === "number"))];
  }
}

function checkFinite(contours: readonly Contour[]): void {
  for (const c of contours) {
    for (const [x, y] of c.points) if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SketchUsageError({ detail: "a brushed shape has a non-finite coordinate" });
  }
}

function baseColour(paint: Paint, colors: ColorParser): { r: number; g: number; b: number; a: number } {
  if (typeof paint !== "string") throw new SketchUsageError({ detail: "hueJitter and lightJitter need a solid stroke colour, not a gradient" });
  const [r, g, b, a] = colors(paint);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a };
}

function expandIn(req: ExpandRequest, b: Mat): MarkSet | SmearSet | undefined {
  const s = Math.sqrt(Math.abs(det(b)));
  if (!(s > 0) || !Number.isFinite(s)) return undefined;
  const local = geomContours(req.geom, 0.5 / s);
  checkFinite(local);
  const { brush, gesture } = req.stroke;
  const seed = gesture.seed === undefined ? hashNumbers(geomNumbers(req.geom), 0x811c9dc5) : gesture.seed >>> 0;
  const width = req.weight * s;
  const all = local.map((c, i) => {
    const contour = { points: c.points.map((p) => applyLinear(b, p)), closed: c.closed };
    const own = hashNumbers([i], seed);
    return { samples: shapeSamples({ brush, gesture }, { contour, width, seed: own }), closed: c.closed, seed: own };
  });
  if (brush.kind === "smear") {
    const dabOf = (p: { x: number; y: number; p: number }): { x: number; y: number; r: number; a: number } => ({ x: p.x, y: p.y, r: (width / 2) * (1 - brush.sizeByPressure * (1 - p.p)), a: brush.flow * (1 - brush.opacityByPressure * (1 - p.p)) });
    return { kind: "smear", width, contours: all.map((c) => c.samples.map(dabOf)) };
  }
  const ctx = new RecordingCtx();
  const jitter = jitterOf(brush);
  const base = jitter === undefined ? undefined : baseColour(req.paint, req.colors);
  for (const c of all) {
    const ink = jitter === undefined || base === undefined ? BLACK : jitteredInk(base, { jitter, seed: c.seed });
    const input = { ctx, samples: c.samples, closed: c.closed, width, seed: c.seed, ink, dab: jitter === undefined ? SOFT_DAB : undefined };
    if (brush.kind === "ink") paintInk(input, brush);
    else if (brush.kind === "stamp") paintStamp(input, brush);
    else paintBristle(input, brush);
  }
  return { kind: "marks", dabs: ctx.dabs, polys: ctx.polys, runs: ctx.runs, tint: base?.a };
}

export class BrushExpander {
  readonly #cache = new Map<string, { set: MarkSet | SmearSet | undefined; frame: number }>();
  readonly #enabled: boolean;
  #frame = 0;

  /** Disabled, every stroke is expanded afresh (for cache-equivalence checks). */
  constructor(options?: { enabled?: boolean }) {
    this.#enabled = options?.enabled ?? true;
  }
  /** This frame: brushed strokes asked for, expanded afresh, and reused. */
  stats = { strokes: 0, expanded: 0, hits: 0 };

  /** A new frame: forget strokes the last frame did not ask for. */
  beginFrame(): void {
    this.#frame++;
    for (const [key, e] of this.#cache) if (e.frame < this.#frame - 1) this.#cache.delete(key);
    this.stats = { strokes: 0, expanded: 0, hits: 0 };
  }

  expand(req: ExpandRequest): Expanded | undefined {
    const { b, q } = brushSpace(req.linear);
    const { brush, gesture } = req.stroke;
    const tinted = brush.kind !== "smear" && jitterOf(brush) !== undefined;
    // The geometry, brush and gesture by their structural keys (hashed when recorded); the paint only where it is expanded in.
    const paint = tinted || brush.kind === "smear" ? JSON.stringify(req.paint) : "";
    const key = `${keyOf(req.geom)}|${req.weight}|${keyOf(brush)}|${keyOf(gesture)}|${linearKey(b)}|${paint}`;
    this.stats.strokes++;
    let entry = this.#enabled ? this.#cache.get(key) : undefined;
    if (entry === undefined) {
      entry = { set: expandIn(req, b), frame: this.#frame };
      if (this.#enabled) this.#cache.set(key, entry);
      this.stats.expanded++;
    } else {
      entry.frame = this.#frame;
      this.stats.hits++;
    }
    return entry.set === undefined ? undefined : { set: entry.set, key, q };
  }

  /** Strokes kept between frames. */
  get size(): number {
    return this.#cache.size;
  }

  /** Forget every kept stroke (sleep). */
  clear(): void {
    this.#cache.clear();
  }
}
