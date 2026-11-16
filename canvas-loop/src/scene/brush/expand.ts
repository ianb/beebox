// The shared CPU step for brushed strokes (draft section 9): a stroke is
// prepared for the GPU, which expands it into dabs, capsules, bristle strips
// or smear dabs (gpu/brush-pass.ts).
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
// CPU part of the GPU expansion: each contour's points in brush space, its
// seed, and its sample count fixed by `resample`'s own loop. The expander
// keeps each stroke's prepared stroke, and the GPU's `dabs` entry lays stamp
// dabs, its `capsules` entry draws ink as a union of capsules, its `bristles`
// entry writes bristle strips and its `smears` entry a smudge's or wet
// stroke's dabs (canvas-loop-gpu-brushes.subplan.md).
import type { Contour } from "../../core/contours.js";
import { SketchUsageError } from "../../core/errors.js";
import type { Paint } from "../../core/paint.js";
import { hashNumbers } from "../../core/brush/random.js";
import type { BristleBrush, Brush, BrushKind, Envelope, InkBrush, SmearBrush, StampBrush } from "../../core/brush/types.js";
import type { ColorParser } from "../colors.js";
import { IDENTITY, det } from "../mat.js";
import type { BrushStroke, Geom, Mat } from "../nodes.js";
import { geomContours } from "./contours.js";
import { prepareContour } from "./prepare.js";
import { geomKey, gestureKey, keyOf, linearKey } from "../hash.js";

/** A smudge or wet stroke: prepared for the GPU, whose `smears` entry writes its dabs for the smear pass. */
export interface SmearSet {
  readonly kind: "smear";
  readonly prepared: Prepared;
  readonly brush: SmearBrush;
  readonly tint: undefined;
}
/** A stamp stroke: prepared for the GPU, which lays its dabs. `tint` is the paint's alpha when each dab carries its own colour. */
export interface StampSet {
  readonly kind: "stamp";
  readonly prepared: Prepared;
  readonly brush: StampBrush;
  readonly tint: number | undefined;
}
/** An ink stroke: prepared for the GPU, which draws it as capsules. Ink takes no colour jitter, so no `tint`. */
export interface InkSet {
  readonly kind: "ink";
  readonly prepared: Prepared;
  readonly brush: InkBrush;
  readonly tint: undefined;
}
/** A bristle stroke: prepared for the GPU, which writes each bristle's strips. `tint` as for `StampSet`. */
export interface BristleSet {
  readonly kind: "bristle";
  readonly prepared: Prepared;
  readonly brush: BristleBrush;
  readonly tint: number | undefined;
}
/** A stroke the GPU expands into the mark atlas: stamp, ink or bristle. */
export type GpuSet = StampSet | InkSet | BristleSet;
export interface Expanded {
  readonly set: SmearSet | GpuSet;
  /** What the expansion is kept under: equal keys, equal expansions. */
  readonly key: string;
  /** Brush space → the stroke's logical coordinates (linear part only; orthogonal). */
  readonly q: Mat;
  /** The stroke prepared for the GPU sample pass, kept with the expansion. */
  readonly prepared: () => Prepared;
}

export { POINT_WORDS } from "./prepare.js";

/**
 * One contour after `sample.ts`'s `preparePoints`, in brush space: what fixes
 * its sample indices, decided on the CPU (the contour contract,
 * canvas-loop-gpu-brushes.subplan.md).
 */
export interface PreparedContour {
  /**
   * Per prepared point, `POINT_WORDS` words: x, y (less the contour's
   * `origin`, so f32 keeps their precision far from 0, whatever the stroke's
   * other contours hold), the arc length to it
   * (summed in f64, stored f32), and (a u32) the first sample on or past the
   * segment that starts there.
   */
  readonly geom: Float32Array;
  /** The contour-local origin (brush space, f64): its first prepared point. Its points and GPU samples are relative to it. */
  readonly origin: readonly [number, number];
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

/** How much the brush varies its colour per dab or bristle, or undefined when it does not. */
function jitterOf(brush: Brush): { hue: number; light: number } | undefined {
  if (brush.kind === "ink" || brush.kind === "smear") return undefined;
  const hue = brush.hueJitter ?? 0;
  const light = brush.lightJitter ?? 0;
  return hue > 0 || light > 0 ? { hue, light } : undefined;
}

function baseColour(paint: Paint, colors: ColorParser): { r: number; g: number; b: number; a: number } {
  if (typeof paint !== "string") throw new SketchUsageError({ detail: "hueJitter and lightJitter need a solid stroke colour, not a gradient" });
  const [r, g, b, a] = colors(paint);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a };
}

/** The stroke's contours in its call's coordinates, each with its own seed, and the brush width in brush space; undefined for a degenerate transform. */
function brushLocal(req: ExpandRequest, b: Mat): { local: { contour: Contour; seed: number }[]; width: number } | undefined {
  const s = Math.sqrt(Math.abs(det(b)));
  if (!(s > 0) || !Number.isFinite(s)) return undefined;
  const local = geomContours(req.geom, 0.5 / s);
  checkFinite(local);
  const { gesture } = req.stroke;
  const seed = gesture.seed === undefined ? hashNumbers(geomNumbers(req.geom), 0x811c9dc5) : gesture.seed >>> 0;
  return { local: local.map((contour, i) => ({ contour, seed: hashNumbers([i], seed) })), width: req.weight * s };
}

/** The stroke prepared for the GPU sample pass (brush space, as `expand`); undefined for a degenerate transform. */
export function prepare(req: ExpandRequest): Prepared | undefined {
  return prepareIn(req, brushSpace(req.linear).b);
}

function prepareIn(req: ExpandRequest, b: Mat): Prepared | undefined {
  const c = brushLocal(req, b);
  if (c === undefined) return undefined;
  const { brush, gesture } = req.stroke;
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const contours = c.local.map((k) => prepareContour(k, { b, brush, gesture, width: c.width, box }));
  const wobble = gesture.wobble ?? 0;
  const grown = { x0: box.x0 - wobble, y0: box.y0 - wobble, x1: box.x1 + wobble, y1: box.y1 + wobble };
  const base = brush.kind !== "smear" && jitterOf(brush) !== undefined ? baseColour(req.paint, req.colors) : undefined;
  return { kind: brush.kind, contours, width: c.width, wobble, base, box: grown };
}

function expandIn(req: ExpandRequest, b: Mat): SmearSet | GpuSet | undefined {
  const { brush } = req.stroke;
  const prepared = prepareIn(req, b);
  if (prepared === undefined) return undefined;
  switch (brush.kind) {
    case "stamp":
      return { kind: "stamp", prepared, brush, tint: prepared.base?.a };
    case "ink":
      return { kind: "ink", prepared, brush, tint: undefined };
    case "bristle":
      return { kind: "bristle", prepared, brush, tint: prepared.base?.a };
    case "smear":
      return { kind: "smear", prepared, brush, tint: undefined };
  }
}

export class BrushExpander {
  readonly #cache = new Map<string, { set: SmearSet | GpuSet | undefined; frame: number }>();
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
    // The geometry, brush and gesture by their structural keys (hashed when first asked for); the paint only where it is expanded in.
    const paint = tinted || brush.kind === "smear" ? JSON.stringify(req.paint) : "";
    const key = `${geomKey(req.geom)}|${req.weight}|${keyOf(brush)}|${gestureKey(gesture)}|${linearKey(b)}|${paint}`;
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
    const { set } = entry;
    return { set, key, q, prepared: () => set.prepared };
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
