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
// they are asked for (draft section 6); `stats` counts hits. `prepare` is the
// CPU part of the GPU expansion (gpu/brush-pass.ts): the same contours and
// seeds, with each contour's sample count fixed by `resample`'s own loop.
import type { Contour } from "../../core/contours.js";
import { SketchUsageError } from "../../core/errors.js";
import type { Paint } from "../../core/paint.js";
import { hashNumbers } from "../../core/brush/random.js";
import { BLACK, jitterOf, jitteredInk } from "../../core/brush/render/ink.js";
import { paintBristle, paintInk, paintStamp } from "../../core/brush/render/kinds.js";
import { shapeSamples, stepFor, wobbleLattice } from "../../core/brush/render/mark/render.js";
import type { Sample } from "../../core/brush/sample.js";
import { preparePoints, sampleCount } from "../../core/brush/sample.js";
import type { BrushKind, Envelope } from "../../core/brush/types.js";
import type { ColorParser } from "../colors.js";
import { IDENTITY, applyLinear, det } from "../mat.js";
import type { BrushStroke, Geom, Mat } from "../nodes.js";
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
  /** The stroke prepared for the GPU sample pass, made on first use and kept with the expansion. */
  readonly prepared: () => Prepared | undefined;
}

/**
 * One contour after `sample.ts`'s `preparePoints`, in brush space: what fixes
 * its sample indices, decided on the CPU (the contour contract,
 * canvas-loop-gpu-brushes.subplan.md).
 */
export interface PreparedContour {
  /** Per prepared point: x, y, and the arc length to it (summed in f64, stored f32). */
  readonly geom: Float32Array;
  /** Samples, by `resample`'s own loop. */
  readonly count: number;
  readonly step: number;
  /** Arc length (f64 sum). */
  readonly total: number;
  readonly seed: number;
  /** The gesture's pressure, or the default for an open or closed contour. */
  readonly pressure: Envelope;
  /** The wobble lattice: its wrap (undefined when open) and cell length. */
  readonly period: number | undefined;
  readonly cell: number;
}

/** A brushed stroke prepared for the GPU: its contours, width and wobble in brush space, jitter base colour, and a conservative box. */
export interface Prepared {
  readonly kind: BrushKind;
  readonly contours: readonly PreparedContour[];
  readonly width: number;
  readonly wobble: number;
  readonly base: { r: number; g: number; b: number; a: number } | undefined;
  /** Every sample lies inside, wobble included (brush space). */
  readonly box: { x0: number; y0: number; x1: number; y1: number };
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

/** The stroke's contours in brush space, each with its own seed, and the brush width there; undefined for a degenerate transform. */
function brushContours(req: ExpandRequest, b: Mat): { contours: { contour: Contour; seed: number }[]; width: number } | undefined {
  const s = Math.sqrt(Math.abs(det(b)));
  if (!(s > 0) || !Number.isFinite(s)) return undefined;
  const local = geomContours(req.geom, 0.5 / s);
  checkFinite(local);
  const { gesture } = req.stroke;
  const seed = gesture.seed === undefined ? hashNumbers(geomNumbers(req.geom), 0x811c9dc5) : gesture.seed >>> 0;
  const contours = local.map((c, i) => ({ contour: { points: c.points.map((p) => applyLinear(b, p)), closed: c.closed }, seed: hashNumbers([i], seed) }));
  return { contours, width: req.weight * s };
}

type Sampled = { samples: Sample[]; closed: boolean; seed: number }[];

/** Each contour's CPU samples (brush space), and the brush width there. */
function sampledIn(req: ExpandRequest, b: Mat): { all: Sampled; width: number } | undefined {
  const c = brushContours(req, b);
  if (c === undefined) return undefined;
  const { brush, gesture } = req.stroke;
  const { width } = c;
  return { all: c.contours.map((k) => ({ samples: shapeSamples({ brush, gesture }, { contour: k.contour, width, seed: k.seed }), closed: k.contour.closed, seed: k.seed })), width };
}

/** The CPU samples of each contour, as the expansion draws them (brush space): the GPU sample pass's reference. */
export function brushSamples(req: ExpandRequest): Sampled | undefined {
  return sampledIn(req, brushSpace(req.linear).b)?.all;
}

function prepareContour(c: { contour: Contour; seed: number }, a: { req: ExpandRequest; width: number; box: Prepared["box"] }): PreparedContour {
  const pts = preparePoints(c.contour.points, c.contour.closed);
  const geom = new Float32Array(pts.length * 3);
  let total = 0;
  for (const [i, p] of pts.entries()) {
    const prev = pts[i - 1];
    if (prev !== undefined) total += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    geom[i * 3] = p[0];
    geom[i * 3 + 1] = p[1];
    geom[i * 3 + 2] = total;
    a.box.x0 = Math.min(a.box.x0, p[0]);
    a.box.y0 = Math.min(a.box.y0, p[1]);
    a.box.x1 = Math.max(a.box.x1, p[0]);
    a.box.y1 = Math.max(a.box.y1, p[1]);
  }
  const { brush, gesture } = a.req.stroke;
  const step = stepFor(brush, a.width);
  const count = sampleCount(total, step, pts.length);
  const { period, cell } = wobbleLattice(c.contour.closed, count === 1 ? 0 : total);
  return { geom, count, step, total, seed: c.seed, pressure: gesture.pressure ?? (c.contour.closed ? "even" : "taper"), period, cell };
}

/** The stroke prepared for the GPU sample pass (brush space, as `expand`); undefined for a degenerate transform. */
export function prepare(req: ExpandRequest): Prepared | undefined {
  return prepareIn(req, brushSpace(req.linear).b);
}

function prepareIn(req: ExpandRequest, b: Mat): Prepared | undefined {
  const c = brushContours(req, b);
  if (c === undefined) return undefined;
  const { brush, gesture } = req.stroke;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const contours = c.contours.map((k) => prepareContour(k, { req, width: c.width, box }));
  const wobble = gesture.wobble ?? 0;
  const grown = { x0: box.x0 - wobble, y0: box.y0 - wobble, x1: box.x1 + wobble, y1: box.y1 + wobble };
  const base = brush.kind !== "smear" && jitterOf(brush) !== undefined ? baseColour(req.paint, req.colors) : undefined;
  return { kind: brush.kind, contours, width: c.width, wobble, base, box: grown };
}

function expandIn(req: ExpandRequest, b: Mat): MarkSet | SmearSet | undefined {
  const sampled = sampledIn(req, b);
  if (sampled === undefined) return undefined;
  const { brush } = req.stroke;
  const { all, width } = sampled;
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
  readonly #cache = new Map<string, { set: MarkSet | SmearSet | undefined; frame: number; prep?: Prepared | undefined }>();
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
    if (entry.set === undefined) return undefined;
    const kept = entry;
    const prepared = (): Prepared | undefined => (kept.prep ??= prepareIn(req, b));
    return { set: entry.set, key, q, prepared };
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
