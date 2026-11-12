// One mark, start to finish: contours (user space) → device samples with
// pressure and wobble → coverage on a bounds-cropped layer → paper grain cut
// out → coloured → composited once onto the target.
//
// Coordinate contract: the brush follows the transform the way a Canvas2D
// stroke does (scale(2) doubles position and width). Width in device pixels is
// strokeWeight × sqrt(|det|), so a non-uniform scale gives a round brush, not an
// elliptical one. Everything after the transform runs in device pixels, which
// is also where the paper lives, so grain stays fixed to the canvas.
import type { Contour } from "../../contours.js";
import { SketchUsageError } from "../../errors.js";
import type { Ctx2D, CtxTransform, Layer, Paint, Vec2 } from "../../paint.js";
import { inPaintSpace, resolveGradient } from "../../paint.js";
import { evalEnvelope, validateEnvelope } from "../envelope.js";
import { bristleReach, paintBristle, paintInk, paintStamp } from "./kinds.js";
import { hashNumbers, noise1 } from "../random.js";
import type { Sample } from "../sample.js";
import { resample } from "../sample.js";
import type { Brush, Gesture } from "../types.js";

export interface MarkRequest {
  readonly target: Ctx2D;
  /** A reusable canvas-sized layer: the mark draws in its top-left corner, cleared and clipped to the mark's bounds. */
  readonly scratch: Layer;
  /** A second reusable layer, for painting a gradient before it colours the mark. */
  readonly paintScratch: Layer;
  /** Read the mark's strongest pixel back (for faint-mark warnings); costly in a browser, where it stalls the GPU. */
  readonly measure: boolean;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly contours: readonly Contour[];
  readonly paint: Paint;
  readonly weight: number;
  readonly brush: Brush;
  readonly gesture: Gesture;
  readonly paper: () => Layer;
  /** The `globalCompositeOperation` to land the mark with (erase/blend resolved). */
  readonly composite: string;
}

function apply(m: CtxTransform, p: Vec2): Vec2 {
  return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
}

/** Wobble noise wavelength, in device pixels. */
const WOBBLE_CELL = 28;

function stepFor(brush: Brush, width: number): number {
  switch (brush.kind) {
    case "ink":
      return Math.max(0.5, width / 6);
    case "stamp":
      return Math.max(0.25, width * brush.spacing);
    case "bristle":
      return Math.max(0.75, Math.min(3, width / 8));
  }
}

function validate(req: MarkRequest): void {
  if (!Number.isFinite(req.weight) || req.weight <= 0) {
    throw new SketchUsageError({ detail: `strokeWeight must be a positive number for a brushed mark, got ${req.weight}` });
  }
  const g = req.gesture;
  if (g.pressure !== undefined) validateEnvelope(g.pressure, "gesture pressure");
  if (g.wobble !== undefined && (!Number.isFinite(g.wobble) || g.wobble < 0)) {
    throw new SketchUsageError({ detail: "gesture wobble must be a finite number ≥ 0" });
  }
  if (g.seed !== undefined && !Number.isFinite(g.seed)) throw new SketchUsageError({ detail: "gesture seed must be a finite number" });
  for (const c of req.contours) {
    for (const [x, y] of c.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new SketchUsageError({ detail: "a brushed shape has a non-finite coordinate" });
    }
  }
}

/**
 * The mark's random seed: its explicit `gesture.seed`, or a hash of its device
 * points alone. Brush, pressure, width and opacity are left out on purpose, so
 * tuning them keeps the same wobble and scatter (a diff then shows only the
 * tuned change, not a re-rolled mark).
 */
function markSeed(req: MarkRequest, device: readonly Contour[]): number {
  if (req.gesture.seed !== undefined) return req.gesture.seed >>> 0;
  return hashNumbers(device.flatMap((c) => c.points.flat()), 0x811c9dc5);
}

function shapeSamples(req: MarkRequest, args: { contour: Contour; width: number; seed: number }): Sample[] {
  const samples = resample(args.contour.points, { closed: args.contour.closed, step: stepFor(req.brush, args.width) });
  const pressure = req.gesture.pressure ?? (args.contour.closed ? "even" : "taper");
  const wobble = req.gesture.wobble ?? 0;
  const total = samples.at(-1)?.s ?? 0;
  // A closed loop gets a whole number of noise cells around it, wrapping, so
  // the wobble at the end meets the wobble at the start.
  const period = args.contour.closed ? Math.max(1, Math.round(total / WOBBLE_CELL)) : undefined;
  const cell = period === undefined ? WOBBLE_CELL : total / period;
  for (const s of samples) {
    s.p = evalEnvelope(pressure, s.t);
    if (wobble > 0) {
      const at = period === undefined ? { channel: 1, x: s.s / cell } : { channel: 1, x: s.s / cell, period };
      const w = wobble * noise1(args.seed, at);
      s.x += s.nx * w;
      s.y += s.ny * w;
    }
  }
  return samples;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boundsOf(all: readonly Sample[][], args: { pad: number; canvas: MarkRequest["canvas"] }): Bounds | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of all.flat()) {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  const x = Math.max(0, Math.floor(x0 - args.pad));
  const y = Math.max(0, Math.floor(y0 - args.pad));
  const w = Math.min(args.canvas.width, Math.ceil(x1 + args.pad)) - x;
  const h = Math.min(args.canvas.height, Math.ceil(y1 + args.pad)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}

function paintKind(ctx: Ctx2D, args: { brush: Brush; samples: Sample[]; closed: boolean; width: number; seed: number }): void {
  const input = { ctx, samples: args.samples, closed: args.closed, width: args.width, seed: args.seed };
  switch (args.brush.kind) {
    case "ink":
      paintInk(input, args.brush);
      break;
    case "stamp":
      paintStamp(input, args.brush);
      break;
    case "bristle":
      paintBristle(input, args.brush);
      break;
  }
}

/** Fill the layer's coverage with the paint, keeping the coverage's alpha. */
function colorize(layer: Layer, args: { paint: Paint; m: CtxTransform; b: Bounds; paintScratch: Layer }): void {
  const { ctx } = layer;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-in";
  if (typeof args.paint === "string") {
    ctx.fillStyle = args.paint;
    ctx.fillRect(0, 0, args.b.w, args.b.h);
    return;
  }
  // A gradient is defined in the sketch's user space, so it is painted under that transform, on a
  // second layer, then applied with source-in under identity: @napi-rs/canvas 1.0.2 limits a
  // source-in fill under a transform to the quadrant past the translation origin.
  const { m, b } = args;
  const pc = args.paintScratch.ctx;
  pc.save();
  pc.setTransform(1, 0, 0, 1, 0, 0);
  pc.clearRect(0, 0, b.w, b.h);
  pc.setTransform(m.a, m.b, m.c, m.d, m.e - b.x, m.f - b.y);
  pc.fillStyle = resolveGradient(pc, args.paint);
  const det = m.a * m.d - m.b * m.c;
  const inv = (p: Vec2): Vec2 => {
    const x = p[0] + b.x - m.e;
    const y = p[1] + b.y - m.f;
    return [(m.d * x - m.c * y) / det, (m.a * y - m.b * x) / det];
  };
  const corners = [inv([0, 0]), inv([b.w, 0]), inv([0, b.h]), inv([b.w, b.h])];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  pc.beginPath();
  pc.rect(x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0);
  const paint = args.paint;
  inPaintSpace(pc, { paint, fill: () => pc.fill() });
  pc.restore();
  ctx.drawImage(args.paintScratch.image, 0, 0, b.w, b.h, 0, 0, b.w, b.h);
}

/** The strongest pixel's alpha (0..1) on a layer, sampling every other pixel. */
function peakAlpha(layer: Layer, b: Bounds): number {
  const { data } = layer.ctx.getImageData(0, 0, b.w, b.h);
  let peak = 0;
  for (let i = 3; i < data.length; i += 8) peak = Math.max(peak, data[i] ?? 0);
  return peak / 255;
}

/**
 * Paint one brushed mark onto `req.target`. Returns how strong it landed (its
 * strongest pixel's alpha times the brush opacity) and where, or undefined
 * when nothing was drawn.
 */
export function renderMark(req: MarkRequest): { alpha: number; x: number; y: number } | undefined {
  validate(req);
  const m = req.target.getTransform();
  const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
  if (scale === 0) return undefined;
  const width = req.weight * scale;
  const device = req.contours.map((c) => ({ points: c.points.map((p) => apply(m, p)), closed: c.closed }));
  const seed = markSeed(req, device);
  const all = device.map((contour, i) => shapeSamples(req, { contour, width, seed: hashNumbers([i], seed) }));
  const reach = req.brush.kind === "bristle" ? bristleReach(width, req.brush) : width * (1 + (req.brush.kind === "stamp" ? req.brush.scatter : 0));
  const b = boundsOf(all, { pad: reach + (req.gesture.wobble ?? 0) + 2, canvas: req.canvas });
  if (b === undefined) return undefined;
  const layer = req.scratch;
  layer.ctx.save();
  layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
  layer.ctx.clearRect(0, 0, b.w, b.h);
  layer.ctx.beginPath();
  layer.ctx.rect(0, 0, b.w, b.h);
  layer.ctx.clip();
  layer.ctx.setTransform(1, 0, 0, 1, -b.x, -b.y);
  layer.ctx.fillStyle = "#000000";
  for (const [i, samples] of all.entries()) {
    const closed = device[i]?.closed ?? false;
    paintKind(layer.ctx, { brush: req.brush, samples, closed, width, seed: hashNumbers([i], seed) });
  }
  if (req.brush.grain > 0) {
    layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
    layer.ctx.globalCompositeOperation = "destination-out";
    layer.ctx.globalAlpha = req.brush.grain;
    layer.ctx.drawImage(req.paper().image, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
  }
  colorize(layer, { paint: req.paint, m, b, paintScratch: req.paintScratch });
  const t = req.target;
  t.save();
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalAlpha = req.brush.opacity;
  t.globalCompositeOperation = req.composite;
  t.drawImage(layer.image, 0, 0, b.w, b.h, b.x, b.y, b.w, b.h);
  t.restore();
  const alpha = req.measure ? peakAlpha(layer, b) * req.brush.opacity : 1;
  layer.ctx.restore();
  return { alpha, x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
