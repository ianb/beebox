// Pointer forest: a meadow of fractal trees that will not grow where you are.
// Trees near the pointer drop their leaves and die back into the grass; where
// the pointer leaves (or when it leaves the canvas), saplings sprout and the
// wood fills in again, often as a different kind of tree.
//
// Trees are recursive branchings down to the leaf (tree-tea.ts) drawn as
// kept pictures per growth level, wood and foliage apart, so a frame only
// places pictures; far trees take the evening air as a tint.
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Util, Vec2, View, Voice } from "@ianbicking/canvas-loop";
import { ok, rng, toward } from "./color-tea.js";
import { AIR, H, HORIZON, W, foreground, glaze, haze, landPicture } from "./land-tea.js";
import { HEIGHT, LEVELS, PALETTES, SHAPES, SPECIES, type Species, VARIANTS, originOf, sizeAt, treePicture } from "./tree-tea.js";

export const params = {
  marker: { type: "boolean", default: false, label: "Show pointer", hint: "a ring where the pointer is (for recordings)" },
  pace: { type: "number", min: 0.5, max: 4, step: 0.5, default: 1, label: "Growth pace" },
  view: { type: "select", options: ["forest", "specimens"] as const, default: "forest", label: "View" },
} as const satisfies ParamsDecl;
type P = typeof params;

export const canvas = { width: W, height: H };

interface Band { readonly y0: number; readonly y1: number; readonly scale: number; readonly n: number; readonly haze: number }
const BANDS: readonly Band[] = [
  { y0: HORIZON + 4, y1: HORIZON + 26, scale: 0.34, n: 24, haze: 0.5 },
  { y0: HORIZON + 34, y1: HORIZON + 70, scale: 0.5, n: 16, haze: 0.32 },
  { y0: HORIZON + 86, y1: HORIZON + 140, scale: 0.7, n: 10, haze: 0.14 },
  { y0: HORIZON + 175, y1: H - 18, scale: 0.92, n: 5, haze: 0 },
];

interface Tree {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly band: number;
  readonly species: Species;
  readonly variant: number;
  /** 0 (bare grass) .. max. */
  readonly growth: number;
  /** Foliage 0..1: drops first when the pointer comes near. */
  readonly leaf: number;
  readonly max: number;
  /** Frames since the pointer last troubled this tree. */
  readonly calm: number;
  /** Calm frames needed before it regrows. */
  readonly delay: number;
  /** Growth per second. */
  readonly rate: number;
  /** Leaves owed to the air, fractional. */
  readonly owed: number;
}

interface FallingLeaf {
  readonly id: number;
  readonly x: number; readonly y: number;
  readonly vx: number; readonly vy: number;
  readonly rot: number; readonly vr: number;
  readonly size: number;
  readonly color: string;
  readonly floor: number;
  readonly age: number;
  /** Frames since it landed, or -1 in the air. */
  readonly landed: number;
  readonly phase: number;
}

export interface Model {
  readonly frame: number;
  readonly pointer: Vec2 | null;
  readonly trees: readonly Tree[];
  readonly leaves: readonly FallingLeaf[];
  readonly nextId: number;
  readonly voices: readonly Voice[];
  readonly matured: number;
}

const R_IN = 70;
const R_OUT = 175;
const FPS = 60;

function pickSpecies(u: Util<P>, band: number): Species {
  // Firs gather at the back, blossom at the front.
  const weights: Record<Species, number> = { oak: 3, birch: 2.5, fir: band < 2 ? 3 : 1.2, blossom: band >= 2 ? 1.6 : 0.6, beech: 0.45 };
  const total = SPECIES.reduce((a, s) => a + weights[s], 0);
  let r = u.random(total);
  for (const s of SPECIES) {
    r -= weights[s];
    if (r <= 0) return s;
  }
  return "oak";
}

export function init(u: Util<P>): Model {
  const trees: Tree[] = [];
  BANDS.forEach((b, band) => {
    for (let i = 0; i < b.n; i++) {
      const x = ((i + 0.5 + (u.random() - 0.5) * 0.85) / b.n) * (W + 60) - 30;
      const y = b.y0 + u.random() * (b.y1 - b.y0);
      const max = Math.round((0.75 + u.random() * 0.25) * LEVELS) / LEVELS;
      trees.push({
        id: trees.length, x, y, band, species: pickSpecies(u, band), variant: Math.floor(u.random(VARIANTS)),
        growth: max, leaf: 1, max, calm: 999, delay: 40 + Math.floor(u.random(80)), rate: 0.11 + u.random(0.06), owed: 0,
      });
    }
  });
  trees.sort((a, b) => a.y - b.y);
  return { frame: 0, pointer: null, trees, leaves: [], nextId: 0, voices: [], matured: 0 };
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Distance from a point to the tree's trunk-and-crown axis at full size. */
function distTo(t: DeepReadonly<Tree>, p: Vec2): number {
  const s = BANDS[t.band]?.scale ?? 1;
  const top = t.y - HEIGHT[t.species] * s * 0.85;
  const bot = t.y - HEIGHT[t.species] * s * 0.1;
  const cy = Math.min(bot, Math.max(top, p[1]));
  return Math.hypot((p[0] - t.x) * 0.9, p[1] - cy);
}

const AUTUMN = [ok([0.74, 0.16, 75]), ok([0.6, 0.18, 45]), ok([0.82, 0.15, 95]), ok([0.5, 0.15, 30])];

interface Step { trees: Tree[]; spawn: { x: number; y: number; floor: number; s: number; species: Species }[]; voices: Voice[]; matured: number }

function stepTree(u: Util<P>, model: DeepReadonly<Model>, t: DeepReadonly<Tree>, out: Step): void {
  const pace = u.params.pace;
  const frame = model.frame + 1;
  const s = BANDS[t.band]?.scale ?? 1;
  const fear = model.pointer === null ? 0 : 1 - smooth(R_IN, R_OUT, distTo(t, model.pointer));
  const calm = fear > 0.02 ? 0 : t.calm + 1;
  const leafT = Math.min(1, Math.max(0, 1 - fear * 2.2));
  const growT = t.max * (1 - smooth(0.5, 0.95, fear));
  let { leaf, growth, species, variant, owed } = t;
  const settled = calm > t.delay / pace;
  if (leaf > leafT) {
    const drop = Math.min(leaf - leafT, (1.5 * pace) / FPS);
    if (leaf >= 0.92 && leaf - drop < 0.92 && growth > 0.15) out.voices.push({ id: `rustle-${t.id}-${frame}`, at: frame, kind: "noise", color: "pink", attack: 0.12, duration: 0.7, gain: 0.05 + 0.06 * s });
    leaf -= drop;
    owed += drop * 26 * sizeAt(growth) * (growth > 0.1 ? 1 : 0);
  } else if (settled && leaf < 1) leaf = Math.min(1, leaf + (1.6 * pace) / FPS);
  if (growth > growT && leaf < 0.4) {
    growth = Math.max(growT, growth - (0.55 * pace) / FPS);
    if (growth <= 0.001 && t.growth > 0.001) {
      growth = 0;
      out.voices.push({ id: `creak-${t.id}-${frame}`, at: frame, kind: "sample", name: "creak", variant: t.id, rate: 0.9 + 0.2 * u.random(), gain: 0.06 + 0.08 * s });
    }
  } else if (growth < growT && settled) {
    if (growth === 0) {
      species = pickSpecies(u, t.band);
      variant = Math.floor(u.random(VARIANTS));
      leaf = 1;
      out.voices.push({ id: `pop-${t.id}-${frame}`, at: frame, kind: "sample", name: "pop", variant: t.id, rate: 0.8 + 0.4 * u.random(), gain: 0.05 + 0.07 * s });
    }
    const before = growth;
    growth = Math.min(growT, growth + (t.rate * pace) / FPS);
    if (before < t.max * 0.99 && growth >= t.max * 0.99) {
      out.voices.push({ id: `bloom-${t.id}-${frame}`, at: frame, kind: "note", instrument: "kalimba", note: u.scaleNote((out.matured % 8) - 2), gain: 0.05 + 0.06 * s });
      out.matured += 1;
    }
  }
  let whole = 0;
  while (owed >= 1) { owed -= 1; whole += 1; }
  const h = HEIGHT[species] * s * sizeAt(growth);
  for (let i = 0; i < whole; i++) out.spawn.push({ x: t.x + (u.random() - 0.5) * h * 0.7, y: t.y - h * (0.45 + u.random() * 0.45), floor: t.y + u.random(10 * s), s, species });
  out.trees.push({ ...t, leaf, growth, species, variant, calm, owed });
}

function stepLeaves(u: Util<P>, model: DeepReadonly<Model>, spawn: Step["spawn"]): { leaves: FallingLeaf[]; nextId: number } {
  const wind = 0.35 + 0.3 * Math.sin(model.frame / 230);
  const p = model.pointer;
  const moved = model.leaves.flatMap((l): FallingLeaf[] => {
    if (l.landed >= 0) return l.landed >= 149 ? [] : [{ ...l, landed: l.landed + 1 }];
    let vx = l.vx * 0.96 + (wind + Math.sin(l.age * 0.07 + l.phase) * 0.9) * 0.04 * l.size;
    let vy = Math.min(l.vy + 0.012, 0.35 + l.size * 0.22);
    if (p !== null) {
      const dx = l.x - p[0];
      const dy = l.y - p[1];
      const d = Math.hypot(dx, dy);
      if (d < 70 && d > 0.1) { vx += (dx / d) * 0.25; vy += Math.max(0, dy / d) * 0.08; }
    }
    const y = l.y + vy;
    const x = l.x + vx;
    if (y >= l.floor) return [{ ...l, x, y: l.floor, vx: 0, vy: 0, landed: 0 }];
    return [{ ...l, x, y, vx, vy, rot: l.rot + l.vr + vx * 0.03, age: l.age + 1 }];
  });
  let nextId = model.nextId;
  const born = spawn.slice(0, Math.max(0, 320 - moved.length)).map((sp): FallingLeaf => {
    const pal = PALETTES[sp.species];
    const roll = u.random();
    const color = roll < 0.45 ? u.randomChoice(AUTUMN) : ok(roll < 0.75 ? pal.mid : pal.lit);
    return { id: nextId++, x: sp.x, y: sp.y, vx: (u.random() - 0.5) * 0.8, vy: -0.2 * u.random(), rot: u.random(Math.PI * 2), vr: (u.random() - 0.5) * 0.15, size: (1.6 + u.random(1.6)) * (0.5 + sp.s * 0.7), color, floor: sp.floor, age: 0, landed: -1, phase: u.random(6.28) };
  });
  return { leaves: [...moved, ...born], nextId };
}

/** Wind through the wood every few seconds, and a soft pad note now and then. */
function ambience(u: Util<P>, frame: number): Voice[] {
  const out: Voice[] = [];
  if (frame % 240 === 1) out.push({ id: `gust-${frame}`, at: frame, kind: "noise", color: "brown", duration: 3.6 + u.random(1.5), attack: 1.2 + u.random(0.8), gain: 0.16 + u.random(0.08) });
  if (frame % 600 === 1) {
    const step = [0, 2, 4, 1, 3][Math.floor(frame / 600) % 5] ?? 0;
    out.push({ id: `pad-${frame}`, at: frame, kind: "note", instrument: "pad", note: u.scaleNote(step - 5), duration: 4.5, gain: 0.04 });
  }
  return out;
}

// eslint-disable-next-line max-params -- TEA contract signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<P>): Model {
  switch (msg.type) {
    case "mousemove":
      u.handled("pointer");
      return { ...model, pointer: [msg.x, msg.y] } as Model;
    case "mouseleave":
      u.handled("pointer gone");
      return { ...model, pointer: null } as Model;
    case "tick": {
      const out: Step = { trees: [], spawn: [], voices: [], matured: model.matured };
      for (const t of model.trees) stepTree(u, model, t, out);
      const { leaves, nextId } = stepLeaves(u, model, out.spawn);
      const keep = model.voices.filter((vc) => vc.at > msg.frame - 600);
      return { ...(model as Model), frame: msg.frame, trees: out.trees, leaves, nextId, matured: out.matured, voices: [...keep, ...out.voices, ...ambience(u, msg.frame)] as Voice[] };
    }
    case "mousedown":
    case "mouseup":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model as Model;
  }
}

export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.voices as readonly Voice[];
}

const TUFT_R = rng(5);
const FLOWER_COLOURS = [ok([0.95, 0.04, 90]), ok([0.88, 0.16, 95]), ok([0.68, 0.2, 340]), ok([0.64, 0.16, 285])];
const TUFTS = Array.from({ length: 4 }, () => Array.from({ length: 9 }, () => ({ x: (TUFT_R() - 0.5) * 34, h: 6 + TUFT_R() * 12, lean: (TUFT_R() - 0.5) * 8, tone: TUFT_R() })));
const FLOWERS = Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => ({ x: (TUFT_R() - 0.5) * 40, y: (TUFT_R() - 0.5) * 8, h: 5 + TUFT_R() * 9, hue: TUFT_R() })));

function tuft(v: View, k: number): Drawing {
  const blades = TUFTS[k % TUFTS.length] ?? [];
  return v.place(v.picture({ key: "tuft", width: 48, height: 26, deps: [k % TUFTS.length] }, () =>
    blades.map((b, i) => v.line(24 + b.x, 22, 24 + b.x + b.lean, 22 - b.h, { stroke: ok(toward([0.46, 0.13, 150], [0.8, 0.17, 118], b.tone)), weight: 2.2, brush: "ink", gesture: { pressure: "taper-out", seed: i + (k % TUFTS.length) * 20 } })),
  ), -24, -22);
}

function flowers(v: View, k: number, opacity: number): Drawing {
  const fl = FLOWERS[k % FLOWERS.length] ?? [];
  return v.place(v.picture({ key: "flowers", width: 60, height: 30, deps: [k % FLOWERS.length] }, () => [
    fl.map((f, i) => v.line(30 + f.x, 24 + f.y, 30 + f.x + 1, 24 + f.y - f.h, { stroke: ok([0.52, 0.13, 140]), weight: 1.4, brush: "ink", gesture: { seed: i + 40 * (k % FLOWERS.length) } })),
    fl.map((f) => v.circle(31 + f.x, 24 + f.y - f.h, 2.4, { fill: FLOWER_COLOURS[Math.floor(f.hue * FLOWER_COLOURS.length)] ?? "#fff" })),
  ]), -30, -24, { opacity });
}

function drawTree(v: View, t: DeepReadonly<Tree>): Drawing {
  const band = BANDS[t.band] ?? BANDS[0];
  const shape = SHAPES[t.species][t.variant] ?? SHAPES.oak[0];
  if (band === undefined || shape === undefined) return null;
  const level = t.growth * LEVELS;
  const lo = Math.floor(level);
  const frac = level - lo;
  const hi = Math.min(LEVELS, lo + 1);
  // Far trees take the evening air: one picture serves every depth.
  const tint = band.haze > 0 ? ok(AIR, band.haze) : undefined;
  const place = (part: "wood" | "leaf", lv: number, opacity: number): Drawing => {
    if (lv <= 0 || opacity <= 0.01) return null;
    const o = originOf(shape, lv / LEVELS);
    return v.place(treePicture(v, shape, { variant: t.variant, level: lv, part }), -o[0], -o[1], { ...(opacity < 0.99 ? { opacity } : {}), ...(tint === undefined ? {} : { tint }) });
  };
  const s = sizeAt(t.growth);
  const crown = HEIGHT[t.species] * s * 0.32;
  // A long shadow away from the low sun on the left.
  const shadow = t.growth > 0.02 && v.ellipse(crown * 1.8, 3, crown * 2.4, crown * 0.26, {
    fill: v.ellipseGradient(crown * 1.4, 3, crown * 2.6, crown * 0.26, [[0, ok([0.34, 0.1, 265], 0.42)], [0.6, ok([0.34, 0.1, 265], 0.2)], [1, ok([0.34, 0.1, 265], 0)]]),
    blend: "multiply",
  });
  return v.at({ translate: [Math.round(t.x), Math.round(t.y)], scale: band.scale }, [
    flowers(v, t.id, Math.min(1, Math.max(0, 1 - t.growth * 5))),
    shadow,
    place("wood", lo, 1),
    frac > 0.02 && place("wood", hi, frac),
    // Foliage snaps to the nearest level: a crossfaded crown reads as glass.
    place("leaf", Math.round(level), t.leaf < 0.97 ? t.leaf ** 0.6 : 1),
    tuft(v, t.id),
  ]);
}

function drawLeaf(v: View, l: DeepReadonly<FallingLeaf>): Drawing {
  // A landed leaf shrinks into the grass.
  const fade = l.landed < 0 ? 1 : Math.max(0, 1 - l.landed / 150);
  return v.at({ translate: [l.x, l.y], rotate: l.rot }, v.ellipse(0, 0, l.size * fade, l.size * 0.5 * fade, { fill: l.color }));
}

function specimens(v: View): Drawing {
  return [
    v.background(ok([0.95, 0.02, 85])),
    SPECIES.map((sp, row) => [2, 4, 6, 8].map((lv, col) => {
      const shape = SHAPES[sp][0];
      if (shape === undefined) return null;
      const o = originOf(shape, lv / LEVELS);
      return v.at({ translate: [110 + col * 240, 105 + row * 106], scale: 0.52 }, [
        v.place(treePicture(v, shape, { variant: 0, level: lv, part: "wood" }), -o[0], -o[1]),
        v.place(treePicture(v, shape, { variant: 0, level: lv, part: "leaf" }), -o[0], -o[1]),
      ]);
    })),
  ];
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<P>): RootDrawing {
  if (p.view === "specimens") return [specimens(v)];
  return [
    v.place(landPicture(v), 0, 0),
    BANDS.map((b, i) => [
      model.trees.filter((t) => t.band === i).map((t) => drawTree(v, t)),
      b.haze > 0 && haze(v, b.haze * 0.5),
    ]),
    model.leaves.map((l) => drawLeaf(v, l)),
    v.place(foreground(v), 0, H - 130),
    glaze(v),
    p.marker && model.pointer !== null && [
      v.circle(model.pointer[0], model.pointer[1], R_IN, { stroke: "rgba(255,255,255,0.5)", weight: 1.5, dash: [5, 5] }),
      v.circle(model.pointer[0], model.pointer[1], 4, { fill: "rgba(40,30,60,0.8)", stroke: "#fff", weight: 1.5 }),
    ],
  ];
}
