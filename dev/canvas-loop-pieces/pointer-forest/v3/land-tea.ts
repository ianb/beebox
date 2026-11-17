// The still land, painted once into pictures: a warm evening sky with
// clouds that bloom recursively (each puff carries smaller puffs on its
// crown), ridges made by midpoint displacement (the same jag at every
// scale), the meadow, and ferns whose fronds are fronds of fronds.
import type { Drawing, PathCommand, Picture, Vec2, View } from "@ianbicking/canvas-loop";
import { type Lch, ok, rng, toward } from "./color-tea.js";

export const W = 960;
export const H = 540;
export const HORIZON = 262;

export const SKY_TOP: Lch = [0.56, 0.12, 262];
export const SKY_MID: Lch = [0.74, 0.1, 315];
export const SKY_LOW: Lch = [0.9, 0.1, 72];
/** The air between here and the far trees, for tints and haze. */
export const AIR: Lch = [0.84, 0.06, 300];
const SUN: Vec2 = [215, 200];

const R = rng(77);

// ── Clouds: a puff, and on its upper rim smaller puffs, and on theirs smaller still. ──

interface Puff { readonly x: number; readonly y: number; readonly r: number; readonly depth: number }

function bloom(p: Puff, r: () => number, out: Puff[]): void {
  out.push(p);
  if (p.depth >= 3 || p.r < 4) return;
  const n = 3 + Math.floor(r() * 2);
  for (let i = 0; i < n; i++) {
    // Across the top half of the rim, flattened: cumulus grow up and out.
    const a = Math.PI * (1.08 + (i + 0.3 + r() * 0.4) / n * 0.84);
    const cr = p.r * (0.42 + r() * 0.16);
    bloom({ x: p.x + Math.cos(a) * p.r * 0.95, y: p.y + Math.sin(a) * p.r * 0.62, r: cr, depth: p.depth + 1 }, r, out);
  }
}

const CLOUDS = [
  { x: 560, y: 92, r: 46 }, { x: 830, y: 150, r: 30 }, { x: 140, y: 110, r: 26 }, { x: 690, y: 205, r: 20 }, { x: 380, y: 170, r: 16 },
].map((c, i) => {
  const puffs: Puff[] = [];
  const r = rng(300 + i);
  for (let k = -2; k <= 2; k++) bloom({ x: c.x + k * c.r * 0.9, y: c.y + Math.abs(k) * c.r * 0.12, r: c.r * (1 - Math.abs(k) * 0.22), depth: 0 }, r, puffs);
  return { ...c, puffs: puffs.toSorted((a, b) => a.depth - b.depth) };
});

// ── Ridges: midpoint displacement, halving the jag at each halving of the step. ──

function ridge(a: { base: number; amp: number; seed: number; rough: number }): Vec2[] {
  const r = rng(a.seed);
  const n = 128;
  const ys = new Array<number>(n + 1).fill(0);
  ys[0] = (r() - 0.5) * a.amp;
  ys[n] = (r() - 0.5) * a.amp;
  for (let step = n, amp = a.amp; step > 1; step /= 2, amp *= a.rough) {
    for (let i = step / 2; i < n; i += step) ys[i] = ((ys[i - step / 2] ?? 0) + (ys[i + step / 2] ?? 0)) / 2 + (r() - 0.5) * amp;
  }
  return [[-10, H], ...ys.map((y, i): Vec2 => [-10 + (i / n) * (W + 20), a.base - Math.abs(y)]), [W + 10, H]];
}

function sky(v: View): Drawing {
  return [
    v.rect(0, 0, W, H, { fill: v.linearGradient(0, 0, 0, HORIZON + 30, [[0, ok(SKY_TOP)], [0.5, ok(SKY_MID)], [1, ok(SKY_LOW)]]) }),
    v.circle(SUN[0], SUN[1], 300, { fill: v.radialGradient(SUN[0], SUN[1], 300, [[0, ok([0.98, 0.09, 90], 0.95)], [0.12, ok([0.95, 0.12, 80], 0.6)], [0.4, ok([0.88, 0.12, 60], 0.18)], [1, ok([0.85, 0.1, 40], 0)]]) }),
    CLOUDS.map((c) => [
      // The cloud's shaded underside, one soft band along its base.
      v.ellipse(c.x, c.y + c.r * 0.35, c.r * 3.2, c.r * 0.55, { fill: v.ellipseGradient(c.x, c.y + c.r * 0.35, c.r * 3.2, c.r * 0.55, [[0, ok([0.66, 0.09, 300], 0.55)], [1, ok([0.66, 0.09, 300], 0)]]) }),
      c.puffs.map((p) => {
        // Lit from the low sun on the left: gold where it faces the sun, violet in the hollows; the crowns of the
        // smaller puffs catch more light. Soft edges, so overlapping puffs read as one billow.
        const toSun = Math.max(0, Math.min(1, 0.45 - (p.x - SUN[0]) / 1500 + p.depth * 0.15));
        const body = toward([0.74, 0.08, 305], [0.95, 0.08, 70], toSun);
        const lit = toward(body, [0.99, 0.05, 85], 0.55);
        const [gx, gy] = [p.x - p.r * 0.25, p.y - p.r * 0.3];
        return v.ellipse(p.x, p.y, p.r * 1.15, p.r * 0.8, { fill: v.radialGradient(gx, gy, p.r * 1.25, [[0, ok(lit, 0.95)], [0.55, ok(body, 0.85)], [0.8, ok(body, 0.4)], [1, ok(body, 0)]]) });
      }),
    ]),
  ];
}

function hills(v: View): Drawing {
  return [
    v.polygon(ridge({ base: HORIZON - 28, amp: 150, seed: 11, rough: 0.56 }), { fill: ok(toward(AIR, [0.66, 0.08, 285], 0.45)) }),
    v.polygon(ridge({ base: HORIZON - 8, amp: 90, seed: 23, rough: 0.58 }), { fill: ok([0.66, 0.09, 262]) }),
    v.polygon(ridge({ base: HORIZON + 8, amp: 50, seed: 37, rough: 0.6 }), { fill: ok([0.6, 0.1, 215]) }),
  ];
}

const MEADOW_FAR: Lch = [0.78, 0.12, 128];
const MEADOW_NEAR: Lch = [0.58, 0.17, 140];
const MEADOW_DEEP: Lch = [0.42, 0.13, 160];
const MEADOW_SUN: Lch = [0.86, 0.17, 108];

const STROKES = Array.from({ length: 150 }, () => ({ x: R() * (W + 120) - 60, t: R(), len: 40 + R() * 120, tone: R() }));

/** Broad patches across the field: olive, teal and gold, sun and cloud shadow. */
const PATCH_COLOURS: Lch[] = [[0.62, 0.11, 115], [0.5, 0.09, 185], [0.84, 0.15, 95], [0.46, 0.1, 150], [0.7, 0.13, 125]];
const PR = rng(515);
const PATCHES = Array.from({ length: 14 }, (_, i) => {
  const t = 0.1 + PR() * 0.85;
  return { x: PR() * W, y: HORIZON + 8 + t * t * (H - HORIZON), rx: 90 + t * 260, ry: 10 + t * 40, colour: PATCH_COLOURS[i % PATCH_COLOURS.length] ?? MEADOW_FAR, alpha: 0.3 + PR() * 0.25 };
});

// ── Flower drifts: a drift is clumps, a clump is tufts, a tuft is blossoms. ──

interface Bloom { readonly x: number; readonly y: number; readonly r: number; readonly hue: number }

// eslint-disable-next-line max-params -- recursive scatter: centre, spread and level travel together
function drift(c: { x: number; y: number; spread: number; level: number; hue: number }, r: () => number, out: Bloom[]): void {
  const n = c.level === 0 ? 1 : 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = c.level === 0 ? 0 : c.spread * Math.sqrt(r());
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * 0.3;
    if (c.level === 0) out.push({ x, y, r: 0.6 + (y - HORIZON) / 200, hue: c.hue });
    else drift({ x, y, spread: c.spread * 0.38, level: c.level - 1, hue: c.hue + (r() - 0.5) * 30 }, r, out);
  }
}

const DRIFT_HUES = [95, 330, 290, 60, 20];
const BLOOMS: Bloom[] = [];
{
  const r = rng(909);
  for (let i = 0; i < 10; i++) {
    const t = 0.15 + r() * 0.8;
    drift({ x: r() * W, y: HORIZON + 10 + t * t * (H - HORIZON - 30), spread: 30 + t * 110, level: 3, hue: DRIFT_HUES[i % DRIFT_HUES.length] ?? 95 }, r, BLOOMS);
  }
}

function meadow(v: View): Drawing {
  const groundY = (t: number): number => HORIZON + 2 + t * t * (H - HORIZON + 10);
  return [
    v.polygon(ridge({ base: HORIZON + 16, amp: 14, seed: 41, rough: 0.6 }), {
      fill: v.linearGradient(0, HORIZON, 0, H, [[0, ok(MEADOW_FAR)], [0.45, ok(toward(MEADOW_FAR, MEADOW_NEAR, 0.7))], [1, ok(MEADOW_NEAR)]]),
    }),
    PATCHES.map((p) => v.ellipse(p.x, p.y, p.rx, p.ry, { fill: v.ellipseGradient(p.x, p.y, p.rx, p.ry, [[0, ok(p.colour, p.alpha)], [0.6, ok(p.colour, p.alpha * 0.6)], [1, ok(p.colour, 0)]]) })),
    STROKES.map((s, i) => {
      const y = groundY(s.t);
      const col = toward(toward(MEADOW_FAR, MEADOW_NEAR, s.t), s.tone < 0.45 ? MEADOW_DEEP : MEADOW_SUN, s.tone < 0.45 ? 0.4 : 0.3);
      const len = s.len * (0.4 + s.t);
      return v.line(s.x, y, s.x + len, y + (s.tone - 0.5) * 3, { stroke: ok(col), weight: 4 + s.t * 14, brush: { preset: "bristle", load: 0.6, hueJitter: 10, lightJitter: 0.06, opacity: 0.7 }, gesture: { seed: i } });
    }),
    v.ellipse(300, 330, 300, 46, { fill: v.ellipseGradient(300, 330, 300, 46, [[0, ok([0.9, 0.16, 92], 0.5)], [1, ok([0.9, 0.16, 92], 0)]]) }),
    // Blossoms: a dark dot under each for its stem's shade, then the petals.
    BLOOMS.map((b) => v.circle(b.x + b.r * 0.3, b.y + b.r * 0.4, b.r * 1.1, { fill: ok(MEADOW_DEEP, 0.5) })),
    BLOOMS.map((b) => v.circle(b.x, b.y, b.r, { fill: ok([b.hue > 80 && b.hue < 110 ? 0.9 : 0.74, b.hue > 80 && b.hue < 110 ? 0.15 : 0.17, b.hue]) })),
    v.ellipse(720, 470, 320, 56, { fill: v.ellipseGradient(720, 470, 320, 56, [[0, ok([0.4, 0.1, 250], 0.22)], [1, ok([0.4, 0.1, 250], 0)]]) }),
  ];
}

export function landPicture(v: View): Picture {
  return v.picture({ key: "land", width: W, height: H }, () =>
    v.paper({ scale: 4, contrast: 0.5 }, [
      v.group({ effects: { wash: { granulate: 0.05, edges: 0.1, blotch: 0.1 }, paper: 0.12 } }, [sky(v), hills(v)]),
      v.group({ effects: { wash: { granulate: 0.3, edges: 0.25, blotch: 0.18 }, paper: 0.3 } }, meadow(v)),
    ]),
  );
}

/** A veil of air over the ground between the tree bands: stronger toward the horizon. */
export function haze(v: View, strength: number): Drawing {
  return v.rect(0, HORIZON - 90, W, H - HORIZON + 90, {
    fill: v.linearGradient(0, HORIZON - 90, 0, H, [[0, ok(AIR, 0)], [0.3, ok(AIR, strength)], [0.55, ok(AIR, strength * 0.6)], [1, ok(AIR, strength * 0.15)]]),
  });
}

// ── Ferns: a frond is a stem with pinnae down both sides, and each pinna is a frond. ──

interface Frond { readonly base: Vec2; readonly ang: number; readonly len: number; readonly curl: number; readonly depth: number }

function frond(f: Frond, out: { lines: [Vec2, Vec2, number][] }): void {
  const steps = f.depth === 0 ? 4 : 9;
  let p = f.base;
  let ang = f.ang;
  const seg = f.len / steps;
  for (let i = 0; i < steps; i++) {
    const q: Vec2 = [p[0] + Math.sin(ang) * seg, p[1] - Math.cos(ang) * seg];
    out.lines.push([p, q, f.depth]);
    if (f.depth > 0 && i >= 1) {
      const t = i / steps;
      const plen = f.len * 0.36 * (1 - t) ** 0.8;
      for (const side of [-1, 1]) {
        frond({ base: q, ang: ang + side * (1.15 - t * 0.3), len: plen, curl: f.curl * 1.4 * side, depth: f.depth - 1 }, out);
      }
    }
    ang += f.curl;
    p = q;
  }
}

const FERNS = Array.from({ length: 9 }, (_, i) => ({ x: 30 + i * 112 + (R() - 0.5) * 50, h: 70 + R() * 50, lean: (R() - 0.5) * 0.9, curl: 0.05 + R() * 0.05, tone: R() }));
const FORE = Array.from({ length: 70 }, () => ({ x: R() * (W + 40) - 20, h: 18 + R() * 40, lean: (R() - 0.5) * 22, tone: R(), flower: R() }));

/** Ferns, tall grass and a few flowers along the bottom edge, in front of everything. */
export function foreground(v: View): Picture {
  const blooms = [ok([0.95, 0.04, 95]), ok([0.88, 0.16, 92]), ok([0.66, 0.2, 340]), ok([0.62, 0.17, 290])];
  return v.picture({ key: "foreground", width: W, height: 130 }, () => [
    v.rect(0, 90, W, 40, { fill: v.linearGradient(0, 90, 0, 130, [[0, ok([0.4, 0.12, 150], 0)], [1, ok([0.32, 0.1, 160], 0.6)]]) }),
    FERNS.map((f) => {
      const out: { lines: [Vec2, Vec2, number][] } = { lines: [] };
      for (const spread of [-0.55, 0, 0.5]) frond({ base: [f.x, 134], ang: f.lean + spread, len: f.h * (spread === 0 ? 1 : 0.8), curl: f.curl * (spread < 0 ? -1 : 1), depth: 2 }, out);
      const deep: Lch = [0.3, 0.09, 170];
      const lit: Lch = toward([0.5, 0.14, 150], [0.78, 0.17, 118], f.tone);
      return [2, 1, 0].map((d) => v.path(out.lines.filter((l) => l[2] === d).flatMap(([a, b]): PathCommand[] => [["move", a[0], a[1]], ["line", b[0], b[1]]]), { stroke: ok(d === 2 ? deep : toward(deep, lit, d === 1 ? 0.55 : 1)), weight: d === 2 ? 1.8 : d === 1 ? 1.2 : 1.6, cap: "round" }));
    }),
    FORE.map((g, i) => v.curve([[g.x, 132], [g.x + g.lean * 0.4, 132 - g.h * 0.55], [g.x + g.lean, 132 - g.h]], false, {
      stroke: ok(toward([0.4, 0.12, 152], [0.82, 0.17, 115], g.tone)), weight: 3.2, brush: "ink", gesture: { pressure: "taper-out", seed: i },
    })),
    FORE.filter((g) => g.flower > 0.82).map((g, i) => v.circle(g.x + g.lean, 132 - g.h, 3.2, { fill: blooms[i % blooms.length] ?? "#fff" })),
  ]);
}

/** Late sun over the whole scene: warm toward the sun, cooler and deeper far from it. */
export function glaze(v: View): Drawing {
  return v.rect(0, 0, W, H, {
    fill: v.radialGradient(SUN[0], SUN[1], 950, [[0, ok([0.92, 0.12, 80], 0.5)], [0.45, ok([0.75, 0.09, 50], 0.22)], [1, ok([0.32, 0.1, 285], 0.5)]]),
    blend: "soft-light",
  });
}
