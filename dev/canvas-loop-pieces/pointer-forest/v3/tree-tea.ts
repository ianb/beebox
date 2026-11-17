// Fractal trees: each variant is a fixed recursive branching (built once, at
// module load, from a seed), and a growth value 0..1 reveals it from the
// trunk out. The recursion does not stop at the twigs: each twig ends in a
// sprig that splits the same way, three twiglets, each ending in three
// leaves, so the crown is branches all the way down and the wood shows
// through it. Wood and foliage are separate pictures per growth level.
import type { Drawing, PathCommand, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { type Lch, ok, rng, shift, toward } from "./color-tea.js";

export const SPECIES = ["oak", "birch", "fir", "blossom", "beech"] as const;
export type Species = (typeof SPECIES)[number];
export const VARIANTS = 3;
/** Growth is drawn at this many levels; between levels the next is faded in. */
export const LEVELS = 8;

interface Seg {
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number;
  readonly w0: number; readonly w1: number;
  readonly born: number; readonly dur: number; readonly depth: number;
}

/** A sprig: where a twig ends, which way it points, and how big its fan of leaves is. */
interface Sprig {
  readonly x: number; readonly y: number;
  readonly ang: number;
  readonly r: number;
  readonly born: number;
  /** -1..1: shade to sun, set by where it sits in the crown. */
  readonly tone: number;
  /** Fixed per-sprig scatter: twiglet bends and leaf jitter. */
  readonly jit: readonly number[];
}

export interface Shape {
  readonly species: Species;
  readonly segs: readonly Seg[];
  readonly sprigs: readonly Sprig[];
  readonly minX: number; readonly maxX: number; readonly minY: number;
}

export interface Palette {
  readonly bark: Lch; readonly barkLit: Lch; readonly barkMark?: Lch;
  /** Leaves from deep shade to full sun, and a sun fleck. */
  readonly shade: Lch; readonly mid: Lch; readonly lit: Lch; readonly fleck: Lch;
}

// Lush, not RGB: chroma high at middle lightness, hues that turn bluer in
// shade and yellower in sun, as foliage does under a warm sky.
export const PALETTES: Record<Species, Palette> = {
  oak: { bark: [0.33, 0.04, 50], barkLit: [0.52, 0.05, 60], shade: [0.3, 0.085, 178], mid: [0.5, 0.15, 146], lit: [0.74, 0.18, 124], fleck: [0.9, 0.15, 108] },
  birch: { bark: [0.88, 0.015, 85], barkLit: [0.97, 0.01, 90], barkMark: [0.28, 0.02, 60], shade: [0.4, 0.1, 165], mid: [0.6, 0.16, 140], lit: [0.8, 0.17, 122], fleck: [0.94, 0.12, 104] },
  fir: { bark: [0.3, 0.035, 40], barkLit: [0.42, 0.04, 45], shade: [0.26, 0.06, 215], mid: [0.38, 0.09, 190], lit: [0.55, 0.12, 165], fleck: [0.72, 0.13, 150] },
  beech: { bark: [0.42, 0.02, 250], barkLit: [0.62, 0.02, 240], shade: [0.28, 0.08, 5], mid: [0.44, 0.12, 30], lit: [0.64, 0.14, 55], fleck: [0.82, 0.12, 75] },
  blossom: { bark: [0.32, 0.045, 25], barkLit: [0.48, 0.05, 35], shade: [0.5, 0.1, 340], mid: [0.7, 0.1, 355], lit: [0.86, 0.07, 15], fleck: [0.97, 0.035, 80] },
};

/** Full-growth height in local units, for hit distance and leaf scatter. */
export const HEIGHT: Record<Species, number> = { oak: 150, birch: 175, fir: 185, blossom: 125, beech: 160 };

interface Build { segs: Seg[]; sprigs: Sprig[]; r: () => number }

interface BranchSpec { leader: boolean; depth: number; spread: number; ratio: number; twist: number; lift: number; sprigR: number; sprigFrom: number; droop: number }

const BRANCH: Record<Exclude<Species, "fir">, BranchSpec> = {
  oak: { leader: false, depth: 6, spread: 0.66, ratio: 0.74, twist: 0.3, lift: 0.04, sprigR: 11, sprigFrom: 4, droop: 0 },
  birch: { leader: true, depth: 7, spread: 0.6, ratio: 0.77, twist: 0.16, lift: -0.04, sprigR: 6, sprigFrom: 5, droop: 0.12 },
  beech: { leader: false, depth: 6, spread: 0.56, ratio: 0.76, twist: 0.22, lift: 0.0, sprigR: 11, sprigFrom: 4, droop: 0.05 },
  blossom: { leader: false, depth: 5, spread: 0.8, ratio: 0.72, twist: 0.34, lift: 0.06, sprigR: 12, sprigFrom: 3, droop: 0 },
};

const jitter = (r: () => number): number[] => Array.from({ length: 16 }, () => r());
const TIP_JIT = jitter(rng(4242));

// eslint-disable-next-line max-params -- recursive geometry: position, heading and size travel together
function branch(b: Build, spec: BranchSpec, at: { x: number; y: number; ang: number; len: number; w: number; d: number; born: number }): void {
  const dur = 0.86 / (spec.depth + 1);
  const bend = (b.r() - 0.5) * spec.twist;
  const droop = at.d >= spec.depth - 1 ? spec.droop * Math.sign(at.ang || 1) : 0;
  const a1 = at.ang + bend * 0.5;
  const mx = at.x + Math.sin(a1) * at.len * 0.5;
  const my = at.y - Math.cos(a1) * at.len * 0.5;
  const a2 = at.ang + bend + droop * 2.5;
  const ex = mx + Math.sin(a2) * at.len * 0.5;
  const ey = my - Math.cos(a2) * at.len * 0.5;
  const wEnd = at.w * spec.ratio * 0.95;
  b.segs.push({ x0: at.x, y0: at.y, x1: mx, y1: my, w0: at.w, w1: (at.w + wEnd) / 2, born: at.born, dur: dur / 2, depth: at.d });
  b.segs.push({ x0: mx, y0: my, x1: ex, y1: ey, w0: (at.w + wEnd) / 2, w1: wEnd, born: at.born + dur / 2, dur: dur / 2, depth: at.d });
  const end = at.born + dur;
  if (at.d >= spec.sprigFrom) {
    // A sprig at each limb end from sprigFrom on: inner ones (the crown's bulk) are larger.
    const r = spec.sprigR * (1 + (spec.depth - at.d) * 0.3) * (0.85 + b.r() * 0.3);
    b.sprigs.push({ x: ex, y: ey, ang: a2, r, born: Math.min(0.95, at.born + dur * 0.6), tone: b.r() * 2 - 1, jit: jitter(b.r) });
  }
  if (at.d >= spec.depth) return;
  if (spec.leader) {
    const side = (at.d % 2 === 0 ? 1 : -1) * (b.r() < 0.5 ? 1 : -1);
    branch(b, spec, { x: ex, y: ey, ang: a2 * 0.6 + (b.r() - 0.5) * 0.2, len: at.len * 0.86, w: wEnd, d: at.d + 1, born: end - dur * 0.12 });
    branch(b, spec, { x: ex, y: ey, ang: a2 + side * spec.spread * (0.9 + b.r() * 0.5), len: at.len * 0.62, w: wEnd * 0.7, d: at.d + 1, born: end - dur * 0.12 });
    if (at.d < 3) branch(b, spec, { x: (at.x + ex) / 2, y: (at.y + ey) / 2, ang: a2 - side * spec.spread * (1 + b.r() * 0.4), len: at.len * 0.55, w: wEnd * 0.6, d: at.d + 1, born: at.born + dur * 0.5 });
    return;
  }
  const n = at.d === 0 ? 3 : b.r() < 0.25 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const ang = a2 + t * 2 * spec.spread + (b.r() - 0.5) * 0.3 + Math.sign(a2) * spec.lift * at.d;
    branch(b, spec, { x: ex, y: ey, ang, len: at.len * (spec.ratio + (b.r() - 0.5) * 0.12), w: wEnd, d: at.d + 1, born: end - dur * 0.12 });
  }
}

/** A fir: a leader, and whorls whose branches split again into side shoots, each ending in a sprig of needles. */
function buildFir(b: Build): void {
  const H = HEIGHT.fir;
  const pieces = 10;
  for (let i = 0; i < pieces; i++) {
    const t0 = i / pieces;
    const t1 = (i + 1) / pieces;
    const sway = (b.r() - 0.5) * 2;
    b.segs.push({ x0: sway * 0.5 * t0, y0: -H * t0, x1: sway * 0.5 * t1, y1: -H * t1, w0: 7 * (1 - t0) + 0.8, w1: 7 * (1 - t1) + 0.8, born: t0 * 0.8, dur: 0.08, depth: 0 });
  }
  const whorls = 11;
  for (let k = 0; k < whorls; k++) {
    const h = 0.1 + (k / whorls) * 0.86;
    const y = -H * h;
    const len = 44 * (1 - h) ** 0.85 + 6;
    const born = h * 0.8 + 0.06;
    for (const side of [-1, 1]) {
      // Branches droop, more so low on the tree.
      const ang = side * (2.0 + (1 - h) * 0.25 + (b.r() - 0.5) * 0.2);
      const ex = Math.sin(ang) * len;
      const ey = y - Math.cos(ang) * len;
      b.segs.push({ x0: 0, y0: y, x1: ex, y1: ey, w0: 2.4 * (1 - h) + 0.6, w1: 0.6, born, dur: 0.12, depth: 3 });
      // Side shoots along the branch, the whorl's branching one size down, each ending in a sprig of needles.
      for (const f of [0.5, 0.75]) {
        const sx = ex * f;
        const sy = y + (ey - y) * f;
        for (const turn of [-0.6, 0.6]) {
          const sa = ang + turn * side;
          const sl = len * (1.1 - f) * 0.5 + 4;
          b.sprigs.push({ x: sx + Math.sin(sa) * sl * 0.4, y: sy - Math.cos(sa) * sl * 0.4, ang: sa, r: sl * 0.7, born: Math.min(0.97, born + 0.08 * f), tone: b.r() * 2 - 1, jit: jitter(b.r) });
        }
      }
      b.sprigs.push({ x: ex, y: ey, ang, r: len * 0.25 + 4, born: Math.min(0.97, born + 0.1), tone: b.r() * 2 - 1, jit: jitter(b.r) });
    }
  }
  b.sprigs.push({ x: 0, y: -H * 0.98, ang: 0, r: 8, born: 0.94, tone: 0.6, jit: jitter(b.r) });
}

function buildShape(species: Species, variant: number): Shape {
  const b: Build = { segs: [], sprigs: [], r: rng(1013 + variant * 7919 + SPECIES.indexOf(species) * 104729) };
  if (species === "fir") buildFir(b);
  else {
    const trunk = { oak: { len: 50, w: 10 }, birch: { len: 40, w: 6 }, blossom: { len: 40, w: 9 }, beech: { len: 50, w: 9 } }[species];
    branch(b, BRANCH[species], { x: 0, y: 0, ang: (b.r() - 0.5) * 0.12, len: trunk.len, w: trunk.w, d: 0, born: 0 });
  }
  // Light the crown as one volume, sun from the upper left: a sprig's tone is where it sits, plus a little of its own.
  const cx = b.sprigs.reduce((a, c) => a + c.x, 0) / Math.max(1, b.sprigs.length);
  const cy = b.sprigs.reduce((a, c) => a + c.y, 0) / Math.max(1, b.sprigs.length);
  const reach = Math.max(1, ...b.sprigs.map((c) => Math.hypot(c.x - cx, c.y - cy)));
  const sprigs = b.sprigs
    // Inside the crown is in shade; and a third of the inner sprigs are left out, so the limbs show through.
    .filter((c) => Math.hypot(c.x - cx, c.y - cy) / reach > 0.45 || (c.jit[15] ?? 0) > 0.35)
    .map((c) => {
      const out = Math.hypot(c.x - cx, c.y - cy) / reach;
      const sun = -(((c.x - cx) / reach) * 0.6 + ((c.y - cy) / reach) * 0.9) * 1.1;
      return { ...c, tone: Math.max(-1, Math.min(1, sun * 0.8 + (out - 0.6) * 1.1 + c.tone * 0.25)) };
    })
    .sort((p, q) => p.tone - q.tone);
  const xs = [...b.segs.flatMap((s) => [s.x0, s.x1]), ...sprigs.flatMap((c) => [c.x - c.r * 1.6, c.x + c.r * 1.6])];
  const ys = [...b.segs.map((s) => s.y1), ...sprigs.map((c) => c.y - c.r * 1.6)];
  return { species, segs: b.segs, sprigs, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys) };
}

export const SHAPES: Record<Species, readonly Shape[]> = {
  oak: Array.from({ length: VARIANTS }, (_, i) => buildShape("oak", i)),
  birch: Array.from({ length: VARIANTS }, (_, i) => buildShape("birch", i)),
  fir: Array.from({ length: VARIANTS }, (_, i) => buildShape("fir", i)),
  blossom: Array.from({ length: VARIANTS }, (_, i) => buildShape("blossom", i)),
  beech: Array.from({ length: VARIANTS }, (_, i) => buildShape("beech", i)),
};

/** Overall size at a growth: saplings are small as well as sparse. */
export function sizeAt(g: number): number {
  return 0.28 + 0.72 * g;
}

const PAD = 16;

/** Where the base sits inside a picture of this shape at this growth. */
export function originOf(shape: Shape, g: number): Vec2 {
  const s = sizeAt(g);
  return [Math.ceil(-shape.minX * s + PAD), Math.ceil(-shape.minY * s + PAD)];
}

function boxOf(shape: Shape, g: number): { w: number; h: number } {
  const s = sizeAt(g);
  return { w: Math.ceil((shape.maxX - shape.minX) * s + PAD * 2), h: Math.ceil(-shape.minY * s + PAD * 2) };
}

function reveal(born: number, dur: number, g: number): number {
  return Math.min(1, Math.max(0, (g - born) / dur));
}

function wood(v: View, shape: Shape, g: number, at: Vec2): Drawing {
  const pal = PALETTES[shape.species];
  const s = sizeAt(g);
  const bark = ok(pal.bark);
  const lit = ok(pal.barkLit);
  const visible = shape.segs.map((seg) => ({ seg, f: reveal(seg.born, seg.dur, g) })).filter((e) => e.f > 0);
  const pt = (x: number, y: number): Vec2 => [at[0] + x * s, at[1] + y * s];
  const width = (seg: Seg): number => ((seg.w0 + seg.w1) / 2) * s * (0.55 + 0.45 * g);
  return [
    visible.map(({ seg, f }) => {
      const [ax, ay] = pt(seg.x0, seg.y0);
      const [bx, by] = pt(seg.x0 + (seg.x1 - seg.x0) * f, seg.y0 + (seg.y1 - seg.y0) * f);
      return v.line(ax, ay, bx, by, { stroke: bark, weight: Math.max(0.9, width(seg)), cap: "round" });
    }),
    // The lit flank of the thicker limbs: sun from the upper left.
    visible.filter(({ seg }) => seg.w0 * s > 3).map(({ seg, f }) => {
      const w = width(seg);
      const [ax, ay] = pt(seg.x0, seg.y0);
      const [bx, by] = pt(seg.x0 + (seg.x1 - seg.x0) * f, seg.y0 + (seg.y1 - seg.y0) * f);
      return v.line(ax - w * 0.26, ay, bx - w * 0.26, by, { stroke: lit, weight: w * 0.3, cap: "round" });
    }),
    pal.barkMark !== undefined && visible.filter(({ seg }) => seg.w0 * s > 2.5).flatMap(({ seg, f }, i) => {
      const w = width(seg);
      return [0.3, 0.7].filter((t) => t < f).map((t, j) => {
        const [mx, my] = pt(seg.x0 + (seg.x1 - seg.x0) * t, seg.y0 + (seg.y1 - seg.y0) * t);
        const off = ((i * 7 + j * 3) % 5) / 5 - 0.5;
        return v.line(mx - w * 0.45 + off, my, mx + w * 0.2 + off, my + 0.6, { stroke: ok(pal.barkMark ?? pal.bark), weight: 1.3, cap: "round" });
      });
    }),
  ];
}

/** Each variant leans its foliage a little warmer or cooler, lighter or darker. */
const VARIANT_SHIFT: readonly (readonly [number, number])[] = [[0, 0], [-0.04, 14], [0.03, -12]];

/** A leaf as a pointed oval along `ang`. */
function leafPoints(c: Vec2, a: { ang: number; len: number; wide: number }): Vec2[] {
  const dx = Math.sin(a.ang);
  const dy = -Math.cos(a.ang);
  const along = (t: number, side: number): Vec2 => [c[0] + dx * a.len * t - dy * a.wide * side, c[1] + dy * a.len * t + dx * a.wide * side];
  return [along(-0.5, 0), along(-0.2, 0.9), along(0.2, 1), along(0.5, 0), along(0.2, -1), along(-0.2, -0.9)];
}

interface Leaf { readonly at: Vec2; readonly ang: number; readonly size: number; readonly tone: number; readonly k: number }

/**
 * A sprig, recursively: a twiglet to each of three children turned out from
 * the parent's heading, each a sprig one size down; the last level is a leaf.
 * Twiglets go to `twigs`, leaves to `leaves`.
 */
// eslint-disable-next-line max-params -- recursive geometry: position, heading and size travel together
function sprigTree(c: { at: Vec2; ang: number; r: number; level: number; tone: number; jit: readonly number[]; k: number }, out: { twigs: [Vec2, Vec2, number][]; leaves: Leaf[] }): void {
  if (c.level === 0) {
    out.leaves.push({ at: c.at, ang: c.ang, size: c.r, tone: c.tone, k: c.k });
    return;
  }
  for (let i = 0; i < 3; i++) {
    const j = c.jit[(c.k * 3 + i) % c.jit.length] ?? 0.5;
    const ang = c.ang + (i - 1) * (0.75 + j * 0.3) + (j - 0.5) * 0.2;
    const len = c.r * (i === 1 ? 0.95 : 0.75);
    const end: Vec2 = [c.at[0] + Math.sin(ang) * len, c.at[1] - Math.cos(ang) * len];
    out.twigs.push([c.at, end, c.level]);
    // Children on the sunny side are lighter: the light falls through the sprig too.
    sprigTree({ at: end, ang, r: c.r * 0.55, level: c.level - 1, tone: c.tone + (Math.sin(ang) < 0 ? 0.12 : -0.12) + (j - 0.5) * 0.2, jit: c.jit, k: c.k * 3 + i + 1 }, out);
  }
}

function lchAt(pal: { shade: Lch; mid: Lch; lit: Lch }, t: number): Lch {
  const u = Math.max(0, Math.min(1, (t + 1) / 2));
  return u < 0.5 ? toward(pal.shade, pal.mid, u * 2) : toward(pal.mid, pal.lit, (u - 0.5) * 2);
}

function foliage(v: View, shape: Shape, g: number, at: Vec2, variant: number): Drawing {
  const base = PALETTES[shape.species];
  const [dL, dh] = VARIANT_SHIFT[variant % VARIANT_SHIFT.length] ?? [0, 0];
  const pal = { shade: shift(base.shade, dL, 0, dh), mid: shift(base.mid, dL, 0, dh), lit: shift(base.lit, dL, 0, dh * 0.6) };
  const s = sizeAt(g);
  const fir = shape.species === "fir";
  const twigs: [Vec2, Vec2, number][] = [];
  const leaves: Leaf[] = [];
  // Limbs still growing carry a sprig at their tips, so a sapling is in leaf before its outer twigs exist.
  const key = (x: number, y: number): string => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const started = new Set(shape.segs.filter((seg) => reveal(seg.born, seg.dur, g) > 0.2).map((seg) => key(seg.x0, seg.y0)));
  const growing = fir ? [] : shape.segs.flatMap((seg): Sprig[] => {
    const f = reveal(seg.born, seg.dur, g);
    // A tip: the limb has grown out and nothing grows on from its end yet.
    if (seg.depth < 1 || f <= 0.2 || (f >= 1 && started.has(key(seg.x1, seg.y1)))) return [];
    if (shape.sprigs.some((sp) => sp.born <= g && Math.abs(sp.x - seg.x1) < 0.1 && Math.abs(sp.y - seg.y1) < 0.1)) return [];
    const ang = Math.atan2(seg.x1 - seg.x0, -(seg.y1 - seg.y0));
    return [{ x: seg.x0 + (seg.x1 - seg.x0) * f, y: seg.y0 + (seg.y1 - seg.y0) * f, ang, r: 7 + seg.w0, born: 0, tone: 0.2, jit: TIP_JIT }];
  });
  for (const sp of [...shape.sprigs, ...growing]) {
    const grow = reveal(sp.born, 0.14, g);
    if (grow <= 0.05) continue;
    const r = sp.r * s * grow;
    // Small sprigs recurse once, large ones twice: leaves stay about the same size on the screen.
    const level = r > 9 || (fir && r > 4) ? 2 : 1;
    sprigTree({ at: [at[0] + sp.x * s, at[1] + sp.y * s], ang: sp.ang, r: level === 2 ? r * 0.62 : r * 0.8, level, tone: sp.tone, jit: sp.jit, k: 0 }, { twigs, leaves });
  }
  const twigColour = ok(toward(PALETTES[shape.species].bark, pal.shade, 0.35));
  const leafShape = (l: Leaf, grow: number): Vec2[] => (fir
    ? leafPoints(l.at, { ang: l.ang, len: l.size * 2.4 * grow, wide: l.size * 0.38 * grow })
    : leafPoints(l.at, { ang: l.ang, len: l.size * 2.1 * grow, wide: l.size * 0.85 * grow }));
  // Leaves share a few tones: each tone is one path of many leaves, so a crown is a dozen drawings, not a thousand.
  const BINS = 7;
  const binOf = (l: Leaf): number => {
    const jit = ((l.k * 37) % 11) / 11 - 0.5;
    return Math.max(0, Math.min(BINS - 1, Math.floor(((l.tone + jit * 0.35 + 1) / 2) * BINS)));
  };
  const asPath = (shapes: readonly Vec2[][]): PathCommand[] => shapes.flatMap((pts): PathCommand[] => [["move", pts[0]?.[0] ?? 0, pts[0]?.[1] ?? 0], ...pts.slice(1).map(([x, y]): PathCommand => ["line", x, y]), ["close"]]);
  const lines = (segs: readonly [Vec2, Vec2, number][]): PathCommand[] => segs.flatMap(([a, b]): PathCommand[] => [["move", a[0], a[1]], ["line", b[0], b[1]]]);
  const bins = Array.from({ length: BINS }, (_, i) => leaves.filter((l) => binOf(l) === i));
  const sunny = leaves.filter((l) => l.tone > 0.55);
  return [
    // Shadow under the leaves, down and right: the sprig's depth.
    leaves.length > 0 && v.path(asPath(leaves.map((l) => leafShape({ ...l, at: [l.at[0] + l.size * 0.35, l.at[1] + l.size * 0.45] }, 1.15))), { fill: ok(shift(pal.shade, -0.08, 0, 10), 0.55) }),
    [2, 1].map((lv) => {
      const segs = twigs.filter((t) => t[2] === lv);
      return segs.length > 0 && v.path(lines(segs), { stroke: twigColour, weight: lv === 2 ? 1.1 : 0.75, cap: "round" });
    }),
    bins.map((group, i) => group.length > 0 && v.path(asPath(group.map((l) => leafShape(l, 1))), { fill: ok(lchAt(pal, ((i + 0.5) / BINS) * 2 - 1)) })),
    // Sun on the outermost, sunniest leaves.
    sunny.length > 0 && v.path(asPath(sunny.map((l) => leafShape({ ...l, at: [l.at[0] - l.size * 0.15, l.at[1] - l.size * 0.2] }, 0.5))), { fill: ok(toward(pal.lit, base.fleck, 0.6)) }),
  ];
}

export type Part = "wood" | "leaf";

/** The picture of one variant at one growth level, base at `originOf`. */
export function treePicture(v: View, shape: Shape, a: { variant: number; level: number; part: Part }): Picture {
  const g = a.level / LEVELS;
  const box = boxOf(shape, g);
  const at = originOf(shape, g);
  return v.picture({ key: `${a.part}-${shape.species}-${a.variant}`, width: box.w, height: box.h, deps: [a.level] }, () =>
    a.part === "wood" ? wood(v, shape, g, at) : foliage(v, shape, g, at, a.variant),
  );
}
