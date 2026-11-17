// Trees as soft, layered crowns: each variant is a fixed cloud of puffs
// (built once, at module load, from a seed) over a tapered trunk. Lit from
// the upper left, each puff takes one of four tones, and each tone is one
// path of circles, so a whole crown is a handful of draws. A tree is three
// pictures drawn around its base, (0, 0): wood, the shaded back of the crown,
// and the lit front. The sketch sways the two crown layers by moving them a
// pixel or so (a move reuses the kept image) and grows the tree by scale.
import type { Drawing, PathCommand, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { type Lch, ok, rng } from "./color-tea.js";

export const SPECIES = ["oak", "birch", "fir", "blossom", "beech", "poplar"] as const;
export type Species = (typeof SPECIES)[number];
export const VARIANTS = 3;

interface Palette {
  readonly bark: Lch;
  readonly barkLit: Lch;
  readonly barkMark?: Lch;
  readonly deep: Lch;
  readonly shade: Lch;
  readonly mid: Lch;
  readonly lit: Lch;
  readonly fleck: Lch;
}

export const PALETTES: Record<Species, Palette> = {
  oak: { bark: [0.34, 0.045, 50], barkLit: [0.52, 0.05, 62], deep: [0.3, 0.08, 180], shade: [0.42, 0.12, 160], mid: [0.56, 0.16, 142], lit: [0.73, 0.18, 126], fleck: [0.88, 0.15, 108] },
  birch: { bark: [0.9, 0.012, 85], barkLit: [0.97, 0.008, 90], barkMark: [0.3, 0.02, 60], deep: [0.4, 0.1, 168], shade: [0.53, 0.14, 150], mid: [0.68, 0.17, 134], lit: [0.82, 0.17, 120], fleck: [0.94, 0.12, 104] },
  fir: { bark: [0.3, 0.035, 40], barkLit: [0.42, 0.04, 45], deep: [0.24, 0.05, 222], shade: [0.32, 0.07, 205], mid: [0.42, 0.09, 186], lit: [0.56, 0.11, 168], fleck: [0.72, 0.12, 150] },
  blossom: { bark: [0.33, 0.045, 25], barkLit: [0.48, 0.05, 35], deep: [0.48, 0.12, 345], shade: [0.6, 0.13, 350], mid: [0.73, 0.11, 357], lit: [0.86, 0.07, 10], fleck: [0.97, 0.035, 80] },
  beech: { bark: [0.44, 0.02, 250], barkLit: [0.63, 0.02, 240], deep: [0.27, 0.08, 10], shade: [0.36, 0.11, 22], mid: [0.47, 0.13, 34], lit: [0.63, 0.14, 52], fleck: [0.8, 0.12, 74] },
  poplar: { bark: [0.4, 0.03, 70], barkLit: [0.58, 0.035, 80], deep: [0.34, 0.09, 170], shade: [0.47, 0.13, 152], mid: [0.62, 0.17, 136], lit: [0.78, 0.18, 118], fleck: [0.92, 0.14, 100] },
};

/** Full-growth height in local units, for hit distance and leaf scatter. */
export const HEIGHT: Record<Species, number> = { oak: 190, birch: 205, fir: 205, blossom: 150, beech: 195, poplar: 235 };

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
}

export interface Shape {
  readonly species: Species;
  readonly trunk: readonly Vec2[];
  readonly trunkW: number;
  readonly limbs: readonly Limb[];
  readonly puffs: readonly Puff[];
}

/** The crown's outline at height fraction `f` (0 bottom .. 1 top): half-width, as a fraction of the crown's height. */
const ENVELOPE: Record<Species, (f: number) => number> = {
  oak: (f) => 0.7 * Math.sqrt(Math.max(0, 1 - (2 * f - 0.9) ** 2)),
  birch: (f) => 0.36 * Math.sqrt(Math.max(0, 1 - (2 * f - 0.85) ** 2)),
  fir: (f) => 0.4 * (1 - f) ** 0.95,
  blossom: (f) => 0.88 * Math.sqrt(Math.max(0, 1 - (2 * f - 1.05) ** 2)),
  beech: (f) => 0.6 * Math.sqrt(Math.max(0, 1 - (2 * f - 0.95) ** 2)),
  poplar: (f) => 0.2 * Math.sqrt(Math.max(0, 1 - (2 * f - 0.92) ** 2)),
};

/** Where the crown starts, as a fraction of the height. */
const CROWN_BASE: Record<Species, number> = { oak: 0.32, birch: 0.36, fir: 0.08, blossom: 0.36, beech: 0.3, poplar: 0.14 };

const LIGHT: Vec2 = [-0.62, -0.78];

function build(species: Species, seed: number): Shape {
  const r = rng(seed * 97 + species.length * 13);
  const h = HEIGHT[species] * (0.9 + r() * 0.18);
  const base = CROWN_BASE[species] * h;
  const crownH = h - base;
  const lean = (r() - 0.5) * 0.12;
  const trunkTop: Vec2 = [lean * h * 0.5, -base - crownH * 0.35];
  const trunk: Vec2[] = [[0, 0], [lean * h * 0.15, -base * 0.5], trunkTop];
  const limbs: Limb[] = species === "fir" || species === "poplar" ? [] : Array.from({ length: 3 }, (_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const from = 0.45 + 0.4 * r();
    const sx = trunk[1]?.[0] ?? 0;
    const start: Vec2 = [sx + (trunkTop[0] - sx) * from, -base * (0.5 + from * 0.6)];
    const reach = ENVELOPE[species](0.35) * crownH * (0.5 + 0.4 * r());
    return { pts: [start, [start[0] + side * reach * 0.45, start[1] - crownH * 0.22], [start[0] + side * reach * 0.8, start[1] - crownH * (0.4 + 0.15 * r())]], w: h * (0.03 + r() * 0.015) };
  });
  // The crown is a few clumps, each a cluster of small leaf dabs. A dab is lit by
  // where its clump sits in the crown and where it sits in its clump, so each
  // clump has its own sunny shoulder and shaded belly.
  const puffs: Puff[] = [];
  const clumps = species === "fir" ? 0 : species === "poplar" ? 9 : species === "birch" ? 8 : species === "blossom" ? 9 : 8;
  const crownW = ENVELOPE[species](0.5) * crownH;
  for (let c = 0, tries = 0; c < clumps && tries < 400; tries++) {
    const f = 0.12 + r() * 0.78;
    const half = ENVELOPE[species](f) * crownH;
    if (half < 3) continue;
    c++;
    const R = Math.max(crownH * 0.12, Math.min(half * 0.75, crownH * (species === "poplar" ? 0.16 : 0.24))) * (0.8 + r() * 0.4);
    const cx = (r() * 2 - 1) * Math.max(0, half - R * 0.6);
    const cy = -base - f * crownH;
    const big: Vec2 = [(cx / Math.max(1, crownW)) * 0.8, (0.5 - f) * 1.6];
    const n = Math.round(26 + R * 0.5);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * R;
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d * 0.85;
      const local = (dx / R) * LIGHT[0] + (dy / R) * LIGHT[1];
      const whole = big[0] * LIGHT[0] + big[1] * LIGHT[1];
      const light = Math.max(-1, Math.min(1, local * 0.85 + whole * 0.45 + (r() - 0.5) * 0.35));
      puffs.push({ x: cx + dx + lean * (-cy) * 0.5, y: cy + dy, r: R * (0.2 + r() * 0.16), light });
    }
  }
  // A fir is tiers of dabs along drooping boughs, lit on the left.
  if (species === "fir") {
    const tiers = 9;
    for (let t = 0; t < tiers; t++) {
      const f = t / tiers;
      const half = ENVELOPE.fir(f) * crownH;
      const y0 = -base - f * crownH;
      const n = Math.round(10 + half * 0.5);
      for (let i = 0; i < n; i++) {
        const u = r() * 2 - 1;
        const x = u * half;
        const y = y0 - Math.abs(u) * half * 0.18 + r() * crownH * 0.035 + Math.abs(u) ** 2 * crownH * 0.04;
        const light = Math.max(-1, Math.min(1, -u * 0.8 + (r() - 0.5) * 0.5 - 0.1 * (1 - f)));
        puffs.push({ x, y, r: crownH * (0.022 + 0.03 * (1 - f)) * (0.8 + r() * 0.5), light });
      }
    }
  }
  return { species, trunk, trunkW: h * (species === "fir" ? 0.045 : species === "poplar" ? 0.05 : 0.07), limbs, puffs };
}

const variants = (sp: Species): readonly Shape[] => Array.from({ length: VARIANTS }, (_, i) => build(sp, i + 1));
export const SHAPES: Record<Species, readonly Shape[]> = { oak: variants("oak"), birch: variants("birch"), fir: variants("fir"), blossom: variants("blossom"), beech: variants("beech"), poplar: variants("poplar") };

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

function wood(v: View, shape: Shape): Drawing {
  const pal = PALETTES[shape.species];
  const trunk = v.tube(shape.trunk, { width: shape.trunkW, profile: [[0, 1.25], [0.15, 1], [1, 0.45]] });
  const lit = v.tube(shape.trunk.map(([x, y]) => [x - shape.trunkW * 0.18, y] as Vec2), { width: shape.trunkW * 0.32, profile: [[0, 1], [1, 0.4]] });
  return [
    v.path(trunk, { fill: ok(pal.bark) }),
    v.path(lit, { fill: ok(pal.barkLit, 0.8) }),
    shape.limbs.map((l) => v.path(v.tube(l.pts, { width: l.w, profile: [[0, 1], [1, 0.35]] }), { fill: ok(pal.bark) })),
    pal.barkMark !== undefined && [0.2, 0.38, 0.55, 0.7].map((t, i) => {
      const [x0, y0] = shape.trunk[0] ?? [0, 0];
      const [x1, y1] = shape.trunk[2] ?? [0, 0];
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const w = shape.trunkW * (1 - t * 0.5);
      return v.line(x - w * 0.45, y + (i % 2), x + w * 0.1, y + 1 + (i % 2), { stroke: ok(pal.barkMark ?? pal.bark), weight: 1.6, cap: "round" });
    }),
  ];
}

/** The shaded mass behind: every dab a little larger, in the deep tone, with the shade tone over those turned from the sun. */
function crownBack(v: View, shape: Shape): Drawing {
  const pal = PALETTES[shape.species];
  return [
    v.path(blob(shape.puffs.map((p) => ({ x: p.x + p.r * 0.15, y: p.y + p.r * 0.15, r: p.r * 1.2 }))), { fill: ok(pal.deep) }),
    v.path(blob(shape.puffs.filter((p) => p.light > -0.55).map((p) => ({ x: p.x, y: p.y, r: p.r }))), { fill: ok(pal.shade) }),
  ];
}

/** The lit front: mid, lit and fleck tones, each smaller and nudged toward the sun. */
function crownFront(v: View, shape: Shape): Drawing {
  const pal = PALETTES[shape.species];
  const sun = (p: Puff, k: number, s: number): { x: number; y: number; r: number } => ({ x: p.x + LIGHT[0] * p.r * k, y: p.y + LIGHT[1] * p.r * k, r: p.r * s });
  return [
    v.path(blob(shape.puffs.filter((p) => p.light > -0.15).map((p) => sun(p, 0.15, 0.88))), { fill: ok(pal.mid) }),
    v.path(blob(shape.puffs.filter((p) => p.light > 0.3).map((p) => sun(p, 0.3, 0.66))), { fill: ok(pal.lit) }),
    v.path(blob(shape.puffs.filter((p) => p.light > 0.68).map((p) => sun(p, 0.45, 0.3))), { fill: ok(pal.fleck, 0.85) }),
  ];
}

export type Part = "wood" | "back" | "front";

/** One part of one variant, drawn around its base; it sizes itself. */
export function treePicture(v: View, shape: Shape, a: { variant: number; part: Part }): Picture {
  return v.picture({ key: `${a.part}-${shape.species}-${a.variant}` }, () => (a.part === "wood" ? wood(v, shape) : a.part === "back" ? crownBack(v, shape) : crownFront(v, shape)));
}
