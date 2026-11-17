// Pointer forest: a meadow wood that will not grow where you are. Trees near
// the pointer dry, drop their leaves and shrink back into the grass; once the
// pointer has gone (or left the canvas), they grow back. The wood sways in a
// slow wind. Hover only: clicks do nothing.
//
// Each tree is three kept pictures drawn around its base (tree-tea.ts): the
// wind moves the two crown layers by a pixel or so, which reuses their kept
// images, and growth is a scale in a few steps. The dry look is a `tint`.
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Util, Vec2, View, Voice } from "@ianbicking/canvas-loop";
import { type Lch, ok, rng, toward } from "./color-tea.js";
import { AIR, H, HORIZON, W, foreground, glaze, haze, landPicture } from "./land-tea.js";
import { HEIGHT, PALETTES, SHAPES, SPECIES, type Species, VARIANTS, treePicture } from "./tree-tea.js";

export const params = {
  marker: { type: "boolean", default: false, label: "Show pointer", hint: "a ring where the pointer is (for recordings)" },
} as const satisfies ParamsDecl;
type P = typeof params;

export const canvas = { width: W, height: H };

interface Band { readonly y0: number; readonly y1: number; readonly scale: number; readonly n: number; readonly haze: number }
const BANDS: readonly Band[] = [
  { y0: HORIZON + 4, y1: HORIZON + 26, scale: 0.34, n: 24, haze: 0.5 },
  { y0: HORIZON + 34, y1: HORIZON + 70, scale: 0.5, n: 19, haze: 0.32 },
  { y0: HORIZON + 86, y1: HORIZON + 140, scale: 0.7, n: 12, haze: 0.14 },
  { y0: HORIZON + 175, y1: H - 18, scale: 0.92, n: 5, haze: 0 },
];

interface Tree {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly band: number;
  readonly species: Species;
  readonly variant: number;
  /** 0 (only grass) .. max. */
  readonly growth: number;
  readonly max: number;
  /** How near the pointer is, smoothed: 0 calm .. 1 under it. */
  readonly fear: number;
  /** Frames since the pointer last troubled this tree. */
  readonly calm: number;
  /** Calm frames needed before it regrows. */
  readonly delay: number;
  /** Growth per second. */
  readonly rate: number;
  /** Leaves owed to the air, fractional. */
  readonly owed: number;
  readonly phase: number;
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

const R_IN = 40;
const R_OUT = 120;
const FPS = 60;
/** Growth is drawn at this many sizes: each is one more kept image per part. */
const LEVELS = 12;
const DRY: Lch = [0.72, 0.13, 72];

function pickSpecies(u: Util<P>, band: number): Species {
  // Firs and poplars gather at the back, blossom at the front.
  const weights: Record<Species, number> = { oak: 3, birch: 2.2, fir: band < 2 ? 2.6 : 1, blossom: band >= 2 ? 1.6 : 0.6, beech: 0.6, poplar: band < 3 ? 1.4 : 0.5 };
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
      const max = 0.8 + u.random() * 0.2;
      trees.push({
        id: trees.length, x, y, band, species: pickSpecies(u, band), variant: Math.floor(u.random(VARIANTS)),
        growth: max, max, fear: 0, calm: 999, delay: 45 + Math.floor(u.random(90)), rate: 0.12 + u.random(0.07), owed: 0, phase: u.random(Math.PI * 2),
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

const AUTUMN: readonly Lch[] = [[0.74, 0.16, 75], [0.6, 0.18, 45], [0.82, 0.15, 95], [0.5, 0.15, 30]];

/** How much of the full size a tree at `growth` is drawn at: in `LEVELS` steps, so each step is one kept image. */
function drawnSize(growth: number): number {
  if (growth <= 0) return 0;
  const step = Math.ceil(growth * LEVELS) / LEVELS;
  return 0.18 + 0.82 * step;
}

interface Step { trees: Tree[]; spawn: { x: number; y: number; floor: number; s: number; species: Species }[]; voices: Voice[]; matured: number }

function stepTree(u: Util<P>, model: DeepReadonly<Model>, t: DeepReadonly<Tree>, out: Step): void {
  const frame = model.frame + 1;
  const s = BANDS[t.band]?.scale ?? 1;
  const near = model.pointer === null ? 0 : 1 - smooth(R_IN, R_OUT, distTo(t, model.pointer));
  const fear = t.fear + (near - t.fear) * (near > t.fear ? 0.12 : 0.03);
  const calm = near > 0.02 ? 0 : t.calm + 1;
  const target = t.max * (1 - smooth(0.3, 0.85, near));
  let { growth, species, variant, owed } = t;
  if (growth > target) {
    if (t.fear < 0.35 && fear >= 0.35 && growth > 0.2) out.voices.push({ id: `rustle-${t.id}-${frame}`, at: frame, kind: "noise", color: "pink", attack: 0.1, duration: 0.6, gain: 0.04 + 0.05 * s });
    const before = growth;
    growth = Math.max(target, growth - 1.1 / FPS);
    owed += (before - growth) * 40 * (growth > 0.05 ? 1 : 0.3);
  } else if (growth < target && calm > t.delay) {
    if (growth === 0) {
      species = pickSpecies(u, t.band);
      variant = Math.floor(u.random(VARIANTS));
    }
    const before = growth;
    growth = Math.min(target, growth + t.rate / FPS);
    if (before < t.max * 0.99 && growth >= t.max * 0.99) {
      out.voices.push({ id: `bloom-${t.id}-${frame}`, at: frame, kind: "note", instrument: "kalimba", note: u.scaleNote((out.matured % 8) - 2), gain: 0.04 + 0.05 * s });
      out.matured += 1;
    }
  }
  const h = HEIGHT[species] * s * drawnSize(growth);
  while (owed >= 1) {
    owed -= 1;
    out.spawn.push({ x: t.x + (u.random() - 0.5) * h * 0.7, y: t.y - h * (0.4 + u.random() * 0.5), floor: t.y + u.random(10 * s), s, species });
  }
  out.trees.push({ ...t, growth, species, variant, fear, calm, owed });
}

function stepLeaves(u: Util<P>, model: DeepReadonly<Model>, spawn: Step["spawn"]): { leaves: FallingLeaf[]; nextId: number } {
  const wind = 0.35 + 0.3 * Math.sin(model.frame / 230);
  const p = model.pointer;
  const moved = model.leaves.flatMap((l): FallingLeaf[] => {
    if (l.landed >= 0) return l.landed >= 119 ? [] : [{ ...l, landed: l.landed + 1 }];
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
  const born = spawn.slice(0, Math.max(0, 240 - moved.length)).map((sp): FallingLeaf => {
    const pal = PALETTES[sp.species];
    const roll = u.random();
    const color = ok(roll < 0.5 ? u.randomChoice(AUTUMN) : roll < 0.8 ? pal.mid : pal.lit);
    return { id: nextId++, x: sp.x, y: sp.y, vx: (u.random() - 0.5) * 0.8, vy: -0.2 * u.random(), rot: u.random(Math.PI * 2), vr: (u.random() - 0.5) * 0.15, size: (1.6 + u.random(1.6)) * (0.5 + sp.s * 0.7), color, floor: sp.floor, age: 0, landed: -1, phase: u.random(6.28) };
  });
  return { leaves: [...moved, ...born], nextId };
}

/** Wind through the wood every few seconds, and a soft pad note now and then. */
function ambience(u: Util<P>, frame: number): Voice[] {
  const out: Voice[] = [];
  if (frame % 240 === 1) out.push({ id: `gust-${frame}`, at: frame, kind: "noise", color: "brown", duration: 3.6 + u.random(1.5), attack: 1.2 + u.random(0.8), gain: 0.14 + u.random(0.08) });
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

/** Grass at a tree's foot, drawn around the foot. */
function tuft(v: View, k: number): Drawing {
  const blades = TUFTS[k % TUFTS.length] ?? [];
  return v.place(v.picture({ key: "tuft", deps: [k % TUFTS.length] }, () =>
    blades.map((b, i) => v.line(b.x, 0, b.x + b.lean, -b.h, { stroke: ok(toward([0.46, 0.13, 150], [0.8, 0.17, 118], b.tone)), weight: 2.2, brush: "ink", gesture: { pressure: "taper-out", seed: i + (k % TUFTS.length) * 20 } })),
  ), 0, 2);
}

/** Meadow flowers where a tree has gone. */
function flowers(v: View, k: number, opacity: number): Drawing {
  const fl = FLOWERS[k % FLOWERS.length] ?? [];
  return v.place(v.picture({ key: "flowers", deps: [k % FLOWERS.length] }, () => [
    fl.map((f, i) => v.line(f.x, f.y, f.x + 1, f.y - f.h, { stroke: ok([0.52, 0.13, 140]), weight: 1.4, brush: "ink", gesture: { seed: i + 40 * (k % FLOWERS.length) } })),
    fl.map((f) => v.circle(f.x + 1, f.y - f.h, 2.4, { fill: FLOWER_COLOURS[Math.floor(f.hue * FLOWER_COLOURS.length)] ?? "#fff" })),
  ]), 0, 0, { opacity });
}

/** The tint a tree takes: the evening air with distance, and the dry gold of a tree that the pointer is troubling. */
function tintOf(band: Band, fear: number): string | undefined {
  const dry = Math.min(0.75, fear * 1.1);
  if (band.haze <= 0 && dry <= 0.02) return undefined;
  const alpha = 1 - (1 - band.haze) * (1 - dry);
  return ok(toward(AIR, DRY, dry / (dry + band.haze)), alpha);
}

function drawTree(v: View, t: DeepReadonly<Tree>, frame: number): Drawing {
  const band = BANDS[t.band] ?? BANDS[0];
  const shape = SHAPES[t.species][t.variant] ?? SHAPES.oak[0];
  if (band === undefined || shape === undefined) return null;
  const size = drawnSize(t.growth);
  const scale = band.scale * size;
  const crown = HEIGHT[t.species] * scale * 0.3;
  // Wind: a slow swell travelling across the wood, and a shiver when the pointer is near. In screen pixels.
  const swell = Math.sin(frame / 95 - t.x / 160 + t.phase * 0.3) * 0.6 + Math.sin(frame / 37 + t.phase) * 0.35;
  const sway = (1.2 + 1.6 * band.scale) * swell * size + t.fear * Math.sin(frame * 0.9 + t.phase) * 1.6;
  const tint = tintOf(band, t.fear);
  const opts = tint === undefined ? {} : { tint };
  const part = (p: "wood" | "back" | "front", dx: number): Drawing => v.place(treePicture(v, shape, { variant: t.variant, part: p }), dx / Math.max(0.05, scale), 0, opts);
  return v.at({ translate: [Math.round(t.x), Math.round(t.y)] }, [
    flowers(v, t.id, Math.min(1, Math.max(0, 1 - size * 2.5))),
    size > 0 && [
      // A long shadow away from the low sun on the left.
      v.ellipse(crown * 1.8, 3, crown * 2.4, crown * 0.26, {
        fill: v.ellipseGradient(crown * 1.4, 3, crown * 2.6, crown * 0.26, [[0, ok([0.34, 0.1, 265], 0.42)], [0.6, ok([0.34, 0.1, 265], 0.2)], [1, ok([0.34, 0.1, 265], 0)]]),
        blend: "multiply",
      }),
      v.at({ scale }, [part("wood", 0), part("back", sway * 0.55), part("front", sway)]),
    ],
    v.at({ scale: band.scale }, tuft(v, t.id)),
  ]);
}

function drawLeaf(v: View, l: DeepReadonly<FallingLeaf>): Drawing {
  // A landed leaf shrinks into the grass.
  const fade = l.landed < 0 ? 1 : Math.max(0, 1 - l.landed / 120);
  return v.at({ translate: [l.x, l.y], rotate: l.rot }, v.ellipse(0, 0, l.size * fade, l.size * 0.5 * fade, { fill: l.color }));
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<P>): RootDrawing {
  return [
    v.place(landPicture(v), 0, 0),
    BANDS.map((b, i) => [
      model.trees.filter((t) => t.band === i).map((t) => drawTree(v, t, model.frame)),
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
