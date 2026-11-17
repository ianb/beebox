// Trees that grow. Each variant is a plan built once from a seed: a trunk,
// boughs and twigs, each with the age it starts, how fast it lengthens and
// how long it gets, and leaf clumps that start on a twig at an age of their
// own. `grownAt(plan, age)` reads the plan at an age: which parts exist, how
// long and thick they are, which leaf dabs have come out. Nothing is scaled:
// a young birch is a whip, a young fir has few whorls, and an oak's crown is
// the clumps on the twigs it has so far.
//
// A tree is three pictures drawn around its base, (0, 0): wood, the shaded
// back of the crown (and a birch's hanging twigs), and the lit front. Each
// is kept per species, variant and age level (`LEVELS` of them). The sketch
// sways the two crown layers by moving them a pixel or so.
import type { Drawing, PathCommand, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { type Lch, ok, rng } from "./color-tea.js";

export const SPECIES = ["oak", "birch", "fir", "blossom", "beech", "poplar"] as const;
export type Species = (typeof SPECIES)[number];
export const VARIANTS = 3;
/** Ages are drawn in this many steps: each step is one more kept image per part. */
export const LEVELS = 16;

interface Palette {
  readonly bark: Lch;
  readonly barkLit: Lch;
  readonly barkMark?: Lch;
  readonly twig?: Lch;
  readonly deep: Lch;
  readonly shade: Lch;
  readonly mid: Lch;
  readonly lit: Lch;
  readonly fleck: Lch;
}

export const PALETTES: Record<Species, Palette> = {
  oak: { bark: [0.34, 0.045, 50], barkLit: [0.52, 0.05, 62], deep: [0.3, 0.08, 180], shade: [0.42, 0.12, 160], mid: [0.56, 0.16, 142], lit: [0.73, 0.18, 126], fleck: [0.88, 0.15, 108] },
  birch: { bark: [0.9, 0.012, 85], barkLit: [0.97, 0.008, 90], barkMark: [0.3, 0.02, 60], twig: [0.36, 0.05, 30], deep: [0.4, 0.1, 168], shade: [0.53, 0.14, 150], mid: [0.68, 0.17, 134], lit: [0.82, 0.17, 120], fleck: [0.94, 0.12, 104] },
  fir: { bark: [0.3, 0.035, 40], barkLit: [0.42, 0.04, 45], twig: [0.3, 0.04, 40], deep: [0.24, 0.05, 222], shade: [0.32, 0.07, 205], mid: [0.42, 0.09, 186], lit: [0.56, 0.11, 168], fleck: [0.72, 0.12, 150] },
  blossom: { bark: [0.33, 0.045, 25], barkLit: [0.48, 0.05, 35], deep: [0.48, 0.12, 345], shade: [0.6, 0.13, 350], mid: [0.73, 0.11, 357], lit: [0.86, 0.07, 10], fleck: [0.97, 0.035, 80] },
  beech: { bark: [0.44, 0.02, 250], barkLit: [0.63, 0.02, 240], deep: [0.27, 0.08, 10], shade: [0.36, 0.11, 22], mid: [0.47, 0.13, 34], lit: [0.63, 0.14, 52], fleck: [0.8, 0.12, 74] },
  poplar: { bark: [0.4, 0.03, 70], barkLit: [0.58, 0.035, 80], deep: [0.34, 0.09, 170], shade: [0.47, 0.13, 152], mid: [0.62, 0.17, 136], lit: [0.78, 0.18, 118], fleck: [0.92, 0.14, 100] },
};

/** A blossom tree's leaves, under its flowers. */
const BLOSSOM_LEAF: Palette = { ...PALETTES.blossom, deep: [0.34, 0.07, 170], shade: [0.46, 0.1, 152], mid: [0.58, 0.12, 138], lit: [0.72, 0.13, 124], fleck: [0.86, 0.11, 110] };

/** Full-growth height in local units, for hit distance and leaf scatter. */
export const HEIGHT: Record<Species, number> = { oak: 190, birch: 205, fir: 205, blossom: 150, beech: 195, poplar: 235 };

const LIGHT: Vec2 = [-0.62, -0.78];

/** A trunk, bough or twig. Directions are angles from straight up, clockwise. */
interface Bough {
  /** Index of the bough it grows from, or -1. */
  readonly parent: number;
  /** Distance along the parent where it starts. */
  readonly at: number;
  readonly birth: number;
  /** Starting direction, relative to the parent's there (or absolute when `abs`). */
  readonly dir: number;
  readonly abs: boolean;
  /** Turn per unit length: the further out, the more it has turned. */
  readonly bend: number;
  /** Length per unit of age, up to `max`. */
  readonly rate: number;
  readonly max: number;
  /** Width at the base when grown, and the age span it takes to get there. */
  readonly w: number;
  readonly wSpan: number;
  /** Wood is drawn with the trunk; twigs hang in the crown's back layer. */
  readonly twig: boolean;
  /** Age it is shed at, if it is. */
  readonly death?: number;
}

interface Dab {
  /** In the unit disc, x right, y down. */
  readonly x: number;
  readonly y: number;
  /** Radius as a fraction of the clump's. */
  readonly r: number;
  /** 0..1: when in the clump's own growth it comes out. */
  readonly when: number;
  readonly jitter: number;
}

interface Clump {
  readonly bough: number;
  /** Distance along the bough; past its tip means at the tip. */
  readonly at: number;
  readonly birth: number;
  /** Age span from the first leaf to a full clump. */
  readonly span: number;
  readonly R: number;
  readonly dabs: readonly Dab[];
  readonly death?: number;
  readonly flower: boolean;
}

/** A fir's ring of boughs at one height, seen from the side as one drooping spray. */
interface Whorl {
  readonly at: number;
  readonly birth: number;
  readonly rate: number;
  readonly max: number;
  /** Signed distance out from the trunk, a sag, a radius, and when in the whorl's growth it comes out. */
  readonly dabs: readonly { readonly d: number; readonly dy: number; readonly r: number; readonly when: number; readonly jitter: number }[];
}

export interface Plan {
  readonly species: Species;
  readonly variant: number;
  readonly height: number;
  readonly boughs: readonly Bough[];
  readonly clumps: readonly Clump[];
  readonly whorls: readonly Whorl[];
  /** Birch: lenticel marks up the trunk, by distance along it. */
  readonly marks: readonly { readonly at: number; readonly w: number; readonly side: number; readonly from: number }[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

function dabsFor(r: () => number, n: number, size: [number, number]): Dab[] {
  return Array.from({ length: n }, () => {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    // Dabs near the middle come out first; the edge fills last.
    return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.85, r: size[0] + r() * (size[1] - size[0]), when: clamp01(d * 0.65 + r() * 0.35), jitter: r() - 0.5 };
  });
}

/** When a bough's tip first passes `at`. */
function reach(b: Bough, at: number): number {
  return b.birth + at / b.rate;
}

class Builder {
  readonly boughs: Bough[] = [];
  readonly clumps: Clump[] = [];
  constructor(readonly r: () => number) {}
  bough(b: Omit<Bough, "birth" | "abs" | "twig"> & { delay?: number; after?: number; abs?: boolean; twig?: boolean }): number {
    const parent = this.boughs[b.parent];
    const ready = parent === undefined ? 0 : reach(parent, b.at);
    const { delay, after, ...rest } = b;
    this.boughs.push({ ...rest, birth: Math.max(ready + (delay ?? 0), after ?? 0), abs: b.abs ?? false, twig: b.twig ?? false });
    return this.boughs.length - 1;
  }
  clump(c: { bough: number; at: number; delay: number; span: number; R: number; n: number; size?: [number, number]; death?: number; flower?: boolean }): void {
    const b = this.boughs[c.bough];
    if (b === undefined) return;
    const ready = c.at > b.max ? reach(b, b.max * 0.7) : reach(b, c.at);
    this.clumps.push({ bough: c.bough, at: c.at, birth: ready + c.delay, span: c.span, R: c.R, dabs: dabsFor(this.r, c.n, c.size ?? [0.2, 0.36]), flower: c.flower ?? false, ...(c.death === undefined ? {} : { death: c.death }) });
  }
}

const TIP = 1e9;

/**
 * Oak, beech, blossom and poplar: a trunk that lengthens and thickens, limbs
 * that start as it passes and lengthen and fork, and leaf clumps that start
 * on each new twig and fill in. A blossom flowers last.
 */
function broadleaf(species: Species, r: () => number, h: number): Builder {
  const B = new Builder(r);
  const lean = (r() - 0.5) * 0.1;
  const k = {
    oak: { trunk: 0.74, span: 0.5, w: 0.075, limbs: 6, from: 0.3, to: 0.62, ang: [0.4, 0.95] as const, bend: 0.006, len: 0.34, fork: 0.55, R: 0.12, n: 26 },
    beech: { trunk: 0.8, span: 0.5, w: 0.065, limbs: 7, from: 0.28, to: 0.7, ang: [0.32, 0.8] as const, bend: 0.005, len: 0.3, fork: 0.5, R: 0.115, n: 26 },
    blossom: { trunk: 0.6, span: 0.45, w: 0.08, limbs: 5, from: 0.3, to: 0.52, ang: [0.6, 1.1] as const, bend: 0.006, len: 0.4, fork: 0.55, R: 0.14, n: 24 },
    poplar: { trunk: 0.93, span: 0.6, w: 0.05, limbs: 12, from: 0.14, to: 0.86, ang: [0.16, 0.3] as const, bend: 0.002, len: 0.17, fork: 0, R: 0.07, n: 18 },
    birch: { trunk: 0, span: 0, w: 0, limbs: 0, from: 0, to: 0, ang: [0, 0] as const, bend: 0, len: 0, fork: 0, R: 0, n: 0 },
    fir: { trunk: 0, span: 0, w: 0, limbs: 0, from: 0, to: 0, ang: [0, 0] as const, bend: 0, len: 0, fork: 0, R: 0, n: 0 },
  }[species];
  const trunkMax = h * k.trunk;
  const trunk = B.bough({ parent: -1, at: 0, dir: lean, bend: -lean * 0.004, rate: trunkMax / k.span, max: trunkMax, w: h * k.w, wSpan: 0.95 });
  // A sapling's leaves along its young stem, shed as the limbs take over, and a tuft at the leader's tip.
  for (let i = 0; i < 3; i++) B.clump({ bough: trunk, at: h * (0.1 + i * 0.09), delay: 0.01, span: 0.06, R: h * k.R * 0.28, n: 6, size: [0.32, 0.46], death: (species === "poplar" ? 0.5 : 0.3) + i * 0.04 });
  B.clump({ bough: trunk, at: TIP, delay: -0.62 * k.span, span: 0.12, R: h * k.R * (species === "poplar" ? 0.9 : 0.5), n: 12 });
  const flower = (bough: number, at: number, R: number, n: number, delay: number): void => {
    if (species === "blossom") B.clump({ bough, at, delay, span: 0.16, R: R * 0.95, n: n + 6, size: [0.17, 0.3], flower: true });
  };
  for (let i = 0; i < k.limbs; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const f = k.limbs === 1 ? 0.5 : i / (k.limbs - 1);
    const at = h * (k.from + (k.to - k.from) * (f + ((r() - 0.5) * 0.3) / k.limbs));
    const up = 1 - f * 0.4;
    const ang = side * (k.ang[0] + (k.ang[1] - k.ang[0]) * (r() * 0.4 + (1 - f) * 0.6));
    const len = h * k.len * up * (0.8 + r() * 0.35);
    // Limbs curve up toward the light.
    const limb = B.bough({ parent: trunk, at, dir: ang, bend: -side * k.bend * (0.6 + r() * 0.8), rate: len / (k.fork > 0 ? 0.36 : 0.2), max: len, w: h * k.w * 0.5 * up, wSpan: 0.6, delay: k.fork > 0 ? 0.03 : 0 });
    if (k.fork > 0) {
      for (const [j, at2] of [len * 0.45, len * 0.75].entries()) {
        const fs = j === 0 ? -side : side;
        const fl = len * k.fork * (0.75 + r() * 0.4);
        const fork = B.bough({ parent: limb, at: at2, dir: fs * (0.4 + r() * 0.3), bend: -side * k.bend * 0.5, rate: fl / 0.25, max: fl, w: h * k.w * 0.2, wSpan: 0.4, delay: 0.02 });
        const R = h * k.R * (0.85 + r() * 0.3);
        B.clump({ bough: fork, at: fl * 0.5, delay: 0.04, span: 0.25, R: R * 0.8, n: k.n - 4 });
        B.clump({ bough: fork, at: TIP, delay: 0.0, span: 0.3, R, n: k.n });
        flower(fork, TIP, R, k.n, 0.28);
      }
      const R = h * k.R * (0.95 + r() * 0.3);
      B.clump({ bough: limb, at: len * 0.3, delay: 0.03, span: 0.22, R: R * 0.65, n: k.n - 6, death: 0.8 });
      B.clump({ bough: limb, at: len * 0.6, delay: 0.03, span: 0.3, R: R * 0.85, n: k.n });
      B.clump({ bough: limb, at: TIP, delay: 0.0, span: 0.35, R, n: k.n + 6 });
      flower(limb, TIP, R, k.n, 0.34);
    } else {
      // A poplar's short upright limbs carry leaves all along.
      for (const fr of [0.5, 1.2]) B.clump({ bough: limb, at: fr > 1 ? TIP : len * fr, delay: r() * 0.03, span: 0.18, R: h * k.R * (0.9 + r() * 0.35), n: k.n });
    }
  }
  // The crown's top, over the leader.
  const R = h * k.R * 1.15;
  B.clump({ bough: trunk, at: TIP, delay: 0.05, span: 0.35, R, n: k.n + 8 });
  B.clump({ bough: trunk, at: trunkMax * 0.86, delay: 0.08, span: 0.35, R: R * 0.9, n: k.n });
  flower(trunk, TIP, R, k.n, 0.36);
  return B;
}

/**
 * A birch: a slender white trunk that rises first, as a whip with a few leaves
 * along it; then thin limbs up it, angled up and arching over under their own
 * length; fine twigs hanging from them; small leaf clusters on the twigs late.
 */
function birch(r: () => number, h: number): Builder & { marks: Plan["marks"] } {
  const B = new Builder(r);
  const lean = (r() - 0.5) * 0.08;
  const trunk = B.bough({ parent: -1, at: 0, dir: lean, bend: (r() - 0.5) * 0.0016, rate: h / 0.5, max: h * 0.97, w: h * 0.036, wSpan: 1 });
  // Whip leaves along the young stem, the lowest dropped first as the limbs come.
  for (let i = 0; i < 9; i++) {
    const at = h * (0.08 + i * 0.06);
    B.clump({ bough: trunk, at, delay: 0.01, span: 0.05, R: h * 0.022, n: 4, size: [0.38, 0.5], death: 0.34 + i * 0.04 });
  }
  B.clump({ bough: trunk, at: TIP, delay: -0.4, span: 0.08, R: h * 0.03, n: 6, size: [0.32, 0.45] });
  const limbs = 12;
  for (let i = 0; i < limbs; i++) {
    const f = i / (limbs - 1);
    const side = (i % 2 === 0 ? -1 : 1) * (r() < 0.15 ? -1 : 1);
    const at = h * (0.38 + 0.55 * f + (r() - 0.5) * 0.04);
    // Narrow crown: limbs longest a third of the way up, short at the top.
    const len = h * (0.08 + 0.2 * Math.sin(Math.PI * Math.min(1, 0.22 + f * 0.85))) * (0.8 + r() * 0.35);
    const limb = B.bough({ parent: trunk, at, dir: side * (0.32 + r() * 0.22), bend: side * (0.013 + r() * 0.006) * (205 / h), rate: len / 0.3, max: len, w: h * 0.012, wSpan: 0.5, delay: 0.06 });
    // Hanging twig sprays along the outer limb, each with a few small leaf clusters.
    const sprays = 3 + Math.floor(r() * 2);
    for (let j = 0; j < sprays; j++) {
      const sat = len * (0.4 + 0.6 * (j / Math.max(1, sprays - 1))) * (0.92 + r() * 0.08);
      const tl = h * (0.08 + r() * 0.1) * (0.55 + 0.45 * (1 - f));
      const tw = B.bough({ parent: limb, at: sat, abs: true, dir: side * (Math.PI - 0.3 - r() * 0.3), bend: -side * 0.004, rate: tl / 0.2, max: tl, w: 1.2, wSpan: 0.2, twig: true, delay: 0.02 });
      for (const fr of [0.35, 0.7, 1.5]) B.clump({ bough: tw, at: fr > 1 ? TIP : tl * fr, delay: 0.02 + r() * 0.06, span: 0.2, R: h * (0.015 + r() * 0.008), n: 4, size: [0.4, 0.52] });
    }
    B.clump({ bough: limb, at: len * 0.5, delay: 0.02, span: 0.2, R: h * 0.022, n: 5, size: [0.38, 0.5] });
    B.clump({ bough: limb, at: TIP, delay: 0.02, span: 0.2, R: h * 0.026, n: 6, size: [0.38, 0.5] });
  }
  // Lenticels up the trunk from the start; the dark rough foot of an old birch late.
  const marks = [
    ...Array.from({ length: 20 }, (_, i) => ({ at: h * (0.04 + i * 0.045 + r() * 0.02), w: 0.3 + r() * 0.4, side: r() < 0.5 ? -1 : 1, from: 0 })),
    ...Array.from({ length: 9 }, (_, i) => ({ at: h * (0.01 + i * 0.016 + r() * 0.01), w: 0.55 + r() * 0.45, side: r() < 0.5 ? -1 : 1, from: 0.55 + i * 0.045 + r() * 0.04 })),
  ];
  return Object.assign(B, { marks });
}

/**
 * A fir grows at the top: the leader lengthens, and each year a new whorl of
 * boughs starts at its tip. Older whorls are longer, so the cone comes from
 * their ages; in an old tree the lowest ones thin.
 */
function fir(r: () => number, h: number): { b: Builder; whorls: Whorl[] } {
  const B = new Builder(r);
  const trunk = B.bough({ parent: -1, at: 0, dir: (r() - 0.5) * 0.04, bend: 0, rate: h / 0.93, max: h, w: h * 0.04, wSpan: 1 });
  const trunkB = B.boughs[trunk];
  const whorls: Whorl[] = [];
  const spacing = h * 0.075;
  const reachW = h * 0.32;
  for (let at = h * 0.07; at < h * 0.95; at += spacing * (0.9 + r() * 0.2)) {
    const birth = trunkB === undefined ? 0 : reach(trunkB, at) + 0.02;
    const max = reachW * (0.92 + r() * 0.16) * (1 - (at / h) * 0.15);
    const rate = reachW / 0.85;
    const dabs = Array.from({ length: Math.round(14 + max * 0.75) }, () => {
      const u = r() * 2 - 1;
      const d = Math.sign(u) * Math.abs(u) ** 0.85 * max;
      return { d, dy: r(), r: 0.75 + r() * 0.5, when: r(), jitter: r() - 0.5 };
    });
    whorls.push({ at, birth, rate, max, dabs });
  }
  return { b: B, whorls };
}

function plan(species: Species, variant: number): Plan {
  const r = rng(variant * 97 + species.length * 13 + species.charCodeAt(0));
  const height = HEIGHT[species] * (0.9 + r() * 0.18);
  if (species === "fir") {
    const { b, whorls } = fir(r, height);
    return { species, variant, height, boughs: b.boughs, clumps: b.clumps, whorls, marks: [] };
  }
  if (species === "birch") {
    const b = birch(r, height);
    return { species, variant, height, boughs: b.boughs, clumps: b.clumps, whorls: [], marks: b.marks };
  }
  const b = broadleaf(species, r, height);
  return { species, variant, height, boughs: b.boughs, clumps: b.clumps, whorls: [], marks: [] };
}

const variants = (sp: Species): readonly Plan[] => Array.from({ length: VARIANTS }, (_, i) => plan(sp, i + 1));
export const PLANS: Record<Species, readonly Plan[]> = { oak: variants("oak"), birch: variants("birch"), fir: variants("fir"), blossom: variants("blossom"), beech: variants("beech"), poplar: variants("poplar") };

/** The age drawn for a growth of 0..1: in `LEVELS` steps, so each step is one kept image. */
export function levelOf(growth: number): number {
  return growth <= 0 ? 0 : Math.min(LEVELS, Math.ceil(growth * LEVELS - 1e-9));
}

interface Puff {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  /** -1 (in shade, lower right) .. 1 (in sun, upper left). */
  readonly light: number;
}

interface Limb {
  readonly pts: readonly Vec2[];
  readonly w: number;
  readonly twig: boolean;
  readonly trunk: boolean;
}

/** A plan read at one age. */
export interface Grown {
  readonly species: Species;
  readonly limbs: readonly Limb[];
  readonly leaves: readonly Puff[];
  readonly flowers: readonly Puff[];
  readonly marks: readonly { readonly x: number; readonly y: number; readonly w: number }[];
  readonly height: number;
}

interface Laid {
  readonly pts: Vec2[];
  readonly dirs: number[];
  readonly step: number;
  readonly len: number;
}

function pointAt(l: Laid, at: number): { p: Vec2; dir: number } {
  const s = Math.min(l.len, Math.max(0, at));
  const i = Math.min(l.pts.length - 2, Math.floor(s / l.step));
  const t = l.step > 0 ? (s - i * l.step) / l.step : 0;
  const a = l.pts[i] ?? [0, 0];
  const b = l.pts[i + 1] ?? a;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: l.dirs[i] ?? 0 };
}

const lengthAt = (b: Bough, age: number): number => (age <= b.birth || (b.death !== undefined && age >= b.death) ? 0 : Math.min(b.max, b.rate * (age - b.birth)));

export function grownAt(p: Plan, age: number): Grown {
  const laid: (Laid | null)[] = [];
  const limbs: Limb[] = [];
  for (const [i, b] of p.boughs.entries()) {
    const len = lengthAt(b, age);
    const parent = b.parent < 0 ? undefined : laid[b.parent];
    if (len < 0.6 || parent === null) {
      laid.push(null);
      continue;
    }
    const root = parent === undefined ? { p: [0, 0] as Vec2, dir: 0 } : pointAt(parent, b.at);
    const n = Math.max(2, Math.min(14, Math.ceil(len / 5)));
    const step = len / n;
    const pts: Vec2[] = [root.p];
    const dirs: number[] = [];
    let dir = b.abs ? b.dir : root.dir + b.dir;
    for (let j = 0; j < n; j++) {
      const mid = Math.max(-Math.PI * 0.97, Math.min(Math.PI * 0.97, dir + b.bend * step * 0.5));
      dirs.push(mid);
      const last = pts[pts.length - 1] ?? [0, 0];
      pts.push([last[0] + Math.sin(mid) * step, last[1] - Math.cos(mid) * step]);
      dir = Math.max(-Math.PI * 0.97, Math.min(Math.PI * 0.97, dir + b.bend * step));
    }
    laid.push({ pts, dirs, step, len });
    const grow = clamp01((age - b.birth) / b.wSpan);
    limbs.push({ pts, w: Math.max(b.twig ? 0.8 : 1.4, b.w * (0.12 + 0.88 * grow ** 0.85)), twig: b.twig, trunk: i === 0 });
  }
  // Leaf clumps: their dabs come out from the middle and, if the clump is shed, drop.
  const raw: (Puff & { cx: number; cy: number; flower: boolean })[] = [];
  for (const c of p.clumps) {
    const l = laid[c.bough];
    if (l === null || l === undefined || age <= c.birth) continue;
    const t = clamp01((age - c.birth) / c.span);
    const gone = c.death === undefined ? 0 : clamp01((age - c.death) / 0.06);
    if (gone >= 1) continue;
    const { p: [cx, cy] } = pointAt(l, c.at);
    for (const d of c.dabs) {
      if (d.when > easeOut(t) || (gone > 0 && (d.jitter + 0.5) < gone)) continue;
      raw.push({ x: cx + d.x * c.R, y: cy + d.y * c.R, r: c.R * d.r, light: (d.x * LIGHT[0] + d.y * LIGHT[1]) * 0.85 + d.jitter * 0.35, cx, cy, flower: c.flower });
    }
  }
  // Fir whorls: each lengthens from the trunk; the oldest thin.
  const trunk = laid[0];
  const twigs: Limb[] = [];
  if (trunk !== null && trunk !== undefined) {
    let top = 0;
    for (const w of p.whorls) {
      if (age <= w.birth || w.at > trunk.len) continue;
      top = Math.max(top, w.at);
      const half = Math.min(w.max, Math.max(2.5, w.rate * (age - w.birth)));
      const old = clamp01((age - w.birth - 0.62) / 0.3) * 0.55;
      const { p: [x0, y0] } = pointAt(trunk, w.at);
      const sag = (d: number): number => -Math.abs(d) * 0.1 + (d * d) / (p.height * 0.9);
      for (const sideSign of [-1, 1]) twigs.push({ pts: [[x0, y0], [x0 + sideSign * half * 0.5, y0 + sag(half * 0.5)], [x0 + sideSign * half, y0 + sag(half)]], w: Math.max(0.9, 0.012 * p.height * clamp01((age - w.birth) / 0.5)), twig: false, trunk: false });
      for (const d of w.dabs) {
        if (Math.abs(d.d) > half || d.when < old) continue;
        const rr = p.height * (0.012 + 0.02 * clamp01(half / (p.height * 0.3))) * d.r;
        raw.push({ x: x0 + d.d, y: y0 + sag(d.d) - d.dy * p.height * 0.022 + p.height * 0.008, r: rr, light: -(d.d / Math.max(12, half)) * 0.8 + d.jitter * 0.5 - 0.1, cx: x0, cy: y0, flower: false });
      }
    }
    // The leader above the last whorl: this year's shoot.
    if (p.whorls.length > 0) for (let s = top + 3; s < trunk.len; s += 3.5) {
      const { p: [x, y] } = pointAt(trunk, s);
      const f = (trunk.len - s) / Math.max(1, trunk.len - top);
      raw.push({ x, y, r: p.height * (0.006 + 0.01 * f), light: 0.2, cx: x, cy: y, flower: false });
    }
  }
  // Light by where each clump sits in the crown as it now is.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const d of raw) {
    x0 = Math.min(x0, d.cx); x1 = Math.max(x1, d.cx); y0 = Math.min(y0, d.cy); y1 = Math.max(y1, d.cy);
  }
  const mx = (x0 + x1) / 2, hw = Math.max(15, (x1 - x0) / 2), my = (y0 + y1) / 2, hh = Math.max(15, (y1 - y0) / 2);
  const lit = (d: (typeof raw)[number]): Puff => {
    const whole = ((d.cx - mx) / hw) * 0.8 * LIGHT[0] + ((d.cy - my) / hh) * 0.8 * LIGHT[1];
    return { x: d.x, y: d.y, r: d.r, light: Math.max(-1, Math.min(1, d.light + whole * 0.45)) };
  };
  const marks = trunk === null || trunk === undefined ? [] : p.marks.filter((m) => m.at < trunk.len - 6 && age >= m.from).map((m) => {
    const { p: [x, y] } = pointAt(trunk, m.at);
    return { x, y, w: m.w * m.side };
  });
  return {
    species: p.species,
    limbs: [...twigs, ...limbs],
    leaves: raw.filter((d) => !d.flower).map(lit),
    flowers: raw.filter((d) => d.flower).map(lit),
    marks,
    height: trunk?.len ?? 0,
  };
}

/** How tall a tree of this species is at a growth of 0..1, roughly, for leaf scatter. */
export function heightAt(species: Species, growth: number): number {
  const full = HEIGHT[species];
  const rise = species === "fir" ? 0.93 : species === "birch" ? 0.5 : 0.55;
  return full * Math.min(1, growth / rise);
}

const K = 0.5523;

/** A circle as a closed subpath of four béziers. */
function circle(c: { x: number; y: number; r: number }): PathCommand[] {
  const { x, y, r } = c;
  const k = r * K;
  return [
    ["move", x + r, y],
    ["bezier", x + r, y + k, x + k, y + r, x, y + r],
    ["bezier", x - k, y + r, x - r, y + k, x - r, y],
    ["bezier", x - r, y - k, x - k, y - r, x, y - r],
    ["bezier", x + k, y - r, x + r, y - k, x + r, y],
    ["close"],
  ];
}

const blob = (puffs: readonly { x: number; y: number; r: number }[]): PathCommand[] => puffs.flatMap(circle);

function wood(v: View, g: Grown): Drawing {
  const pal = PALETTES[g.species];
  const trunk = g.limbs.find((l) => l.trunk);
  const boughs = g.limbs.filter((l) => !l.twig && !l.trunk);
  return [
    boughs.map((l) => v.path(v.tube(l.pts, { width: l.w, profile: [[0, 1], [1, 0.3]] }), { fill: ok(g.species === "birch" ? (pal.twig ?? pal.bark) : pal.bark) })),
    trunk !== undefined && [
      v.path(v.tube(trunk.pts, { width: trunk.w, profile: [[0, 1.25], [0.12, 1], [1, 0.22]] }), { fill: ok(pal.bark) }),
      trunk.w > 2.2 && v.path(v.tube(trunk.pts.map(([x, y]) => [x - trunk.w * 0.18, y] as Vec2), { width: trunk.w * 0.32, profile: [[0, 1], [1, 0.3]] }), { fill: ok(pal.barkLit, 0.8) }),
      g.marks.length > 0 && v.path(g.marks.flatMap((m): PathCommand[] => {
        const w = trunk.w * Math.abs(m.w);
        const x = m.w < 0 ? m.x - trunk.w * 0.5 : m.x + trunk.w * 0.5 - w;
        return [["move", x, m.y], ["line", x + w, m.y + 0.6], ["line", x + w, m.y + 1.8], ["line", x, m.y + 1.4], ["close"]];
      }), { fill: ok(pal.barkMark ?? pal.bark) }),
    ],
  ];
}

/** Hanging twigs, then the shaded mass behind: every dab a little larger, in the deep tone, with the shade tone over those turned from the sun. */
function crownBack(v: View, g: Grown): Drawing {
  const pal = g.species === "blossom" ? BLOSSOM_LEAF : PALETTES[g.species];
  const twigs = g.limbs.filter((l) => l.twig);
  return [
    twigs.length > 0 && v.path(twigs.flatMap((l): PathCommand[] => l.pts.map((p, i) => [i === 0 ? "move" : "line", p[0], p[1]])), { stroke: ok(pal.twig ?? pal.bark), weight: 1.3 }),
    v.path(blob(g.leaves.map((p) => ({ x: p.x + p.r * 0.15, y: p.y + p.r * 0.15, r: p.r * 1.2 }))), { fill: ok(pal.deep) }),
    v.path(blob(g.leaves.filter((p) => p.light > -0.55)), { fill: ok(pal.shade) }),
  ];
}

const sun = (p: Puff, k: number, s: number): { x: number; y: number; r: number } => ({ x: p.x + LIGHT[0] * p.r * k, y: p.y + LIGHT[1] * p.r * k, r: p.r * s });

function lit(v: View, puffs: readonly Puff[], pal: Palette): Drawing {
  return [
    v.path(blob(puffs.filter((p) => p.light > -0.15).map((p) => sun(p, 0.15, 0.88))), { fill: ok(pal.mid) }),
    v.path(blob(puffs.filter((p) => p.light > 0.3).map((p) => sun(p, 0.3, 0.66))), { fill: ok(pal.lit) }),
    v.path(blob(puffs.filter((p) => p.light > 0.68).map((p) => sun(p, 0.45, 0.3))), { fill: ok(pal.fleck, 0.85) }),
  ];
}

/** The lit front: mid, lit and fleck tones, each smaller and nudged toward the sun; a blossom's flowers over its leaves. */
function crownFront(v: View, g: Grown): Drawing {
  const pal = PALETTES[g.species];
  if (g.species !== "blossom") return lit(v, g.leaves, pal);
  return [
    lit(v, g.leaves, BLOSSOM_LEAF),
    g.flowers.length > 0 && [
      v.path(blob(g.flowers.map((p) => ({ x: p.x + p.r * 0.12, y: p.y + p.r * 0.12, r: p.r * 1.1 }))), { fill: ok(pal.deep) }),
      v.path(blob(g.flowers.filter((p) => p.light > -0.55)), { fill: ok(pal.shade) }),
      lit(v, g.flowers, pal),
    ],
  ];
}

export type Part = "wood" | "back" | "front";

/** One part of one variant at one age level, drawn around its base; it sizes itself. */
export function treePicture(v: View, p: Plan, a: { part: Part; level: number }): Picture {
  return v.picture({ key: `${a.part}-${p.species}-${p.variant}`, deps: [a.level] }, () => {
    const g = grownAt(p, a.level / LEVELS);
    return a.part === "wood" ? wood(v, g) : a.part === "back" ? crownBack(v, g) : crownFront(v, g);
  });
}
