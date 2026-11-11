// The three brush kinds. Each paints COVERAGE (black, varying alpha) onto the
// mark's layer in device pixels; the pipeline in render.ts then cuts the paper
// grain out of it, colours it, and composites it once.
import { getStroke } from "perfect-freehand";
import type { Ctx2D } from "../../paint.js";
import { noise1, rand } from "../random.js";
import type { Sample } from "../sample.js";
import type { BristleBrush, InkBrush, StampBrush } from "../types.js";

/** What every kind needs to paint one contour. */
export interface KindInput {
  readonly ctx: Ctx2D;
  readonly samples: readonly Sample[];
  readonly closed: boolean;
  /** Stroke width in device pixels at full pressure. */
  readonly width: number;
  readonly seed: number;
}

/** Variable-width ink: perfect-freehand's outline of the pressure-tagged samples, filled. */
export function paintInk(input: KindInput, brush: InkBrush): void {
  const { ctx, samples } = input;
  const points = samples.map((s) => [s.x, s.y, s.p]);
  const first = points[0];
  if (input.closed && first !== undefined && points.length > 2) points.push(first);
  // At pressure 1 perfect-freehand's radius is size × (0.5 + 0.5 × thinning).
  const outline = getStroke(points, {
    size: input.width / (1 + brush.thinning),
    thinning: brush.thinning,
    // perfect-freehand drops outline points closer than (size × smoothing); a
    // high value turns a small circle into a polygon.
    smoothing: 0.08,
    streamline: 0,
    simulatePressure: false,
    last: true,
  });
  if (outline.length < 3) return;
  ctx.beginPath();
  for (const [i, [x, y]] of outline.entries()) {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Dabs along the samples (the samples are already spaced at the dab spacing). */
export function paintStamp(input: KindInput, brush: StampBrush): void {
  const { ctx, width, seed } = input;
  for (const [k, s] of input.samples.entries()) {
    const jitter = 1 + brush.sizeJitter * (rand(seed, { channel: 11, index: k }) - 0.5);
    const radius = (width / 2) * (1 - brush.sizeByPressure * (1 - s.p)) * jitter;
    const alpha = brush.flow * (1 - brush.opacityByPressure * (1 - s.p));
    if (radius <= 0.05 || alpha <= 0) continue;
    const off = brush.scatter * width * (rand(seed, { channel: 12, index: k }) - 0.5);
    const x = s.x + s.nx * off;
    const y = s.y + s.ny * off;
    ctx.globalAlpha = alpha;
    if (brush.tip === "soft") {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "#000000";
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function smoothstep(edge: readonly [number, number], x: number): number {
  const f = Math.min(1, Math.max(0, (x - edge[0]) / (edge[1] - edge[0])));
  return f * f * (3 - 2 * f);
}

interface Bristle {
  readonly offset: number;
  /** This bristle's share of the brush flow, 0.55..1. */
  readonly strength: number;
  readonly thickness: number;
  readonly dryAt: number;
}

function makeBristles(input: KindInput, brush: BristleBrush): Bristle[] {
  const total = input.samples.at(-1)?.s ?? 0;
  const n = Math.round(brush.bristles);
  return Array.from({ length: n }, (_, i) => {
    const r1 = rand(input.seed, { channel: 21, index: i });
    const r2 = rand(input.seed, { channel: 22, index: i });
    const r3 = rand(input.seed, { channel: 23, index: i });
    const offset = -1 + (2 * (i + 0.5)) / n + (brush.spread * (r1 - 0.5) * 2) / n;
    // Outer bristles carry less paint and run dry sooner. A short mark (under
    // about eight widths) never runs dry, so small shapes still get paint.
    const dryAt = (brush.load * total + input.width * 8) * (0.7 + 0.6 * r3) * (1 - 0.35 * Math.abs(offset));
    const strength = 0.55 + 0.45 * rand(input.seed, { channel: 24, index: i });
    return { offset, strength, thickness: (input.width / n) * 2.2 * (1 + brush.spread * (r2 - 0.5)), dryAt };
  });
}

interface BristlePoint {
  readonly x: number;
  readonly y: number;
  /** Alpha bucket (0 = no paint); a run breaks when it changes. */
  readonly level: number;
  readonly width: number;
}

const LEVELS = 5;
/** How far a bristle wanders sideways, as a fraction of the brush's half-width. */
const BRISTLE_DRIFT = 0.12;

function bristlePoints(input: KindInput, args: { b: Bristle; index: number }): BristlePoint[] {
  const { b } = args;
  const reach = Math.abs(b.offset) * 0.7;
  return input.samples.map((c) => {
    const contact = smoothstep([reach - 0.15, reach + 0.1], c.p);
    const dry = 1 - smoothstep([b.dryAt * 0.7, b.dryAt], c.s);
    // In the drying zone the bristle skips: short random gaps along its length.
    const gap = dry < 1 && rand(input.seed, { channel: 30 + args.index, index: Math.floor(c.s / 2.5) }) > dry ? 0 : 1;
    // Paint varies slowly along each bristle, so the bristles do not read as even stripes.
    const load = 0.7 + 0.3 * noise1(input.seed, { channel: 40 + args.index, x: c.s / 18 });
    const alpha = contact * dry * gap * b.strength * load;
    // Bristles wander a little sideways along the stroke, so long strokes do not read as ruled stripes.
    const drift = BRISTLE_DRIFT * noise1(input.seed, { channel: 60 + args.index, x: c.s / 45 });
    const spread = ((b.offset + drift) * input.width * (0.35 + 0.65 * c.p)) / 2;
    return {
      x: c.x + c.nx * spread,
      y: c.y + c.ny * spread,
      level: Math.round(alpha * LEVELS),
      width: b.thickness * (0.5 + 0.5 * c.p),
    };
  });
}

/** Stroke one run of equal-alpha points as a single polyline, so joints never double up. */
function strokeRun(ctx: Ctx2D, args: { run: readonly BristlePoint[]; flow: number }): void {
  const first = args.run[0];
  if (first === undefined || args.run.length < 2 || first.level === 0) return;
  ctx.globalAlpha = (args.flow * first.level) / LEVELS;
  ctx.lineWidth = args.run.reduce((sum, p) => sum + p.width, 0) / args.run.length;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (const p of args.run.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/** Separate bristle lines that narrow with pressure and break up as they run dry. */
export function paintBristle(input: KindInput, brush: BristleBrush): void {
  const { ctx } = input;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";
  for (const [index, b] of makeBristles(input, brush).entries()) {
    let run: BristlePoint[] = [];
    for (const p of bristlePoints(input, { b, index })) {
      const last = run.at(-1);
      if (last !== undefined && last.level !== p.level) {
        // Share the boundary point so consecutive runs meet without a gap.
        run.push({ ...p, level: last.level });
        strokeRun(ctx, { run, flow: brush.flow });
        run = [];
      }
      run.push(p);
    }
    strokeRun(ctx, { run, flow: brush.flow });
  }
  ctx.globalAlpha = 1;
}
