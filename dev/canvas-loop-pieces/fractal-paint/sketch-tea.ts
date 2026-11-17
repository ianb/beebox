// Fractal paint: drag to paint, and each stroke keeps painting itself. When a
// stroke ends, the rule turns it into a few maps (rotate, scale, move) made
// from the stroke's own shape, and copies of the stroke grow out through
// those maps, generation by generation, after your hand has left: a gesture
// becomes a plant, a gasket, a spiral shell or a mandala.
//
// Rules: branch (copies sprout from the stroke's middle and end), gasket
// (copies shrink toward its ends and its bend), spiral (each copy turns and
// shrinks about a point beside the stroke), mandala (sixfold mirror, echoing
// inward). Keys 1–4 pick a rule, p the next palette, c a clean sheet.
//
// Speed: finished paint is a chain of pictures, as in the paint example.
// Each step of the chain is one generation of one stroke laid over the step
// before, so a frame places one picture plus the stroke under the pointer,
// and a generation is drawn once, when it grows.
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Style, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const params = {
  rule: { type: "select", options: ["branch", "gasket", "spiral", "mandala"] as const, default: "branch", label: "Rule", hint: "keys 1–4" },
  palette: { type: "select", options: ["nocturne", "meadow", "coral"] as const, default: "nocturne", label: "Palette", hint: "p; a new palette starts a clean sheet" },
  clear: { type: "trigger", label: "Clean sheet", hint: "c" },
} as const satisfies ParamsDecl;
type P = typeof params;
type Rule = P["rule"]["options"][number];
type PaletteName = P["palette"]["options"][number];
const RULES: readonly Rule[] = ["branch", "gasket", "spiral", "mandala"];
const PALETTE_NAMES: readonly PaletteName[] = ["nocturne", "meadow", "coral"];

export const canvas = { width: 960, height: 600 };
const W = canvas.width;
const H = canvas.height;
const C: Vec2 = [W / 2, H / 2];

type Lch = readonly [number, number, number];
interface Palette { readonly ground: Lch; readonly grain: Lch; readonly paints: readonly Lch[]; readonly bud: Lch; readonly dark: boolean }
const PALETTES: Record<PaletteName, Palette> = {
  nocturne: { ground: [0.2, 0.045, 275], grain: [0.28, 0.06, 285], paints: [[0.82, 0.15, 85], [0.7, 0.17, 32], [0.74, 0.12, 190], [0.64, 0.19, 305], [0.86, 0.13, 140]], bud: [0.96, 0.08, 95], dark: true },
  meadow: { ground: [0.95, 0.025, 88], grain: [0.88, 0.04, 80], paints: [[0.55, 0.14, 145], [0.72, 0.15, 75], [0.55, 0.18, 28], [0.45, 0.13, 262], [0.68, 0.16, 350]], bud: [0.62, 0.2, 20], dark: false },
  coral: { ground: [0.3, 0.06, 215], grain: [0.36, 0.07, 205], paints: [[0.74, 0.16, 38], [0.92, 0.04, 90], [0.72, 0.13, 168], [0.66, 0.17, 355], [0.8, 0.14, 110]], bud: [0.97, 0.05, 60], dark: true },
};

const ok = (c: Lch, alpha = 1): string => `oklch(${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(1)}${alpha < 1 ? ` / ${alpha.toFixed(3)}` : ""})`;

/** An affine map, as Canvas2D: x' = a x + c y + e, y' = b x + d y + f. */
type Mat = readonly [number, number, number, number, number, number];
const ID: Mat = [1, 0, 0, 1, 0, 0];
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: Mat, p: Vec2): Vec2 => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
const scaleOf = (m: Mat): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
/** Rotate by `a` and scale by `k` about point `o`, then move by `to - o`. */
function about(o: Vec2, a: { rot: number; k: number; to?: Vec2; flip?: boolean }): Mat {
  const cs = Math.cos(a.rot) * a.k;
  const sn = Math.sin(a.rot) * a.k;
  const f = a.flip === true ? -1 : 1;
  const to = a.to ?? o;
  // p' = to + R·S·F·(p − o)
  const m: Mat = [cs, sn, -sn * f, cs * f, 0, 0];
  const [x, y] = apply(m, o);
  return [m[0], m[1], m[2], m[3], to[0] - x, to[1] - y];
}

interface Stroke {
  readonly id: number;
  readonly points: readonly Vec2[];
  readonly colour: number;
  readonly rule: Rule;
  /** The frame it was finished on. */
  readonly born: number;
  readonly maps: readonly Mat[];
  readonly gens: number;
  /** Generations baked into the chain so far. */
  readonly baked: number;
}

interface Piece { readonly stroke: number; readonly gen: number }

export interface Model {
  readonly frame: number;
  /** The rule new strokes take: the param, or the last key 1–4. */
  readonly rule: Rule;
  readonly palette: PaletteName;
  /** Each clean sheet gets a new number, so its chain of pictures is new. */
  readonly sheet: number;
  readonly strokes: readonly Stroke[];
  /** The chain: each step lays some pieces over the step before. */
  readonly steps: readonly (readonly Piece[])[];
  readonly wet: { readonly points: readonly Vec2[]; readonly colour: number; readonly rule: Rule } | null;
  readonly nextId: number;
  readonly nextColour: number;
}

export function init(u: Util<P>): Model {
  return { frame: 0, rule: u.params.rule, palette: u.params.palette, sheet: 0, strokes: [], steps: [], wet: null, nextId: 0, nextColour: 0 };
}

const GAP = 7;
const WEIGHT = 16;
const MAX_COPIES = 160;

const dist = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angle = (a: Vec2, b: Vec2): number => Math.atan2(b[1] - a[1], b[0] - a[0]);

/** The point `t` of the way along a polyline, and its heading there. */
function along(pts: readonly Vec2[], t: number): { p: Vec2; dir: number } {
  const lens = pts.slice(1).map((p, i) => dist(pts[i] ?? p, p));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = total * t;
  for (let i = 0; i < lens.length; i++) {
    const l = lens[i] ?? 0;
    const a = pts[i] ?? C;
    const b = pts[i + 1] ?? C;
    if (d <= l || i === lens.length - 1) {
      const u = l === 0 ? 0 : Math.min(1, d / l);
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: angle(a, b) };
    }
    d -= l;
  }
  return { p: pts[0] ?? C, dir: 0 };
}

/** The rule's maps for this stroke, and how many generations it grows. */
function mapsFor(rule: Rule, pts: readonly Vec2[]): { maps: Mat[]; gens: number } {
  const p0 = pts[0] ?? C;
  const pn = pts.at(-1) ?? C;
  const L = Math.max(1, dist(p0, pn));
  const chord = angle(p0, pn);
  switch (rule) {
    case "branch": {
      // A copy of the whole stroke starts at the end (two, splaying) and one at the middle.
      const end = along(pts, 1);
      const mid = along(pts, 0.55);
      return {
        maps: [
          about(p0, { rot: end.dir - chord + 0.48, k: 0.64, to: end.p }),
          about(p0, { rot: end.dir - chord - 0.42, k: 0.58, to: end.p }),
          about(p0, { rot: mid.dir - chord + 1.0, k: 0.42, to: mid.p }),
        ],
        gens: 6,
      };
    }
    case "gasket": {
      // Half-size copies pulled toward the start, the end and the stroke's bend.
      let apex = p0;
      let far = -1;
      for (const p of pts) {
        const d = Math.abs((pn[0] - p0[0]) * (p0[1] - p[1]) - (p0[0] - p[0]) * (pn[1] - p0[1])) / L;
        if (d > far) { far = d; apex = p; }
      }
      if (far < L * 0.12) apex = [(p0[0] + pn[0]) / 2 - Math.sin(chord) * L * 0.45, (p0[1] + pn[1]) / 2 + Math.cos(chord) * L * 0.45];
      return { maps: [about(p0, { rot: 0.12, k: 0.52 }), about(pn, { rot: -0.12, k: 0.52 }), about(apex, { rot: Math.PI, k: 0.5 })], gens: 4 };
    }
    case "spiral": {
      // A centre beside the stroke; each copy turns and shrinks about it.
      const o: Vec2 = [(p0[0] + pn[0]) / 2 - Math.sin(chord) * L * 0.6, (p0[1] + pn[1]) / 2 + Math.cos(chord) * L * 0.6];
      return { maps: [about(o, { rot: 0.55, k: 0.87 })], gens: 16 };
    }
    case "mandala":
      return { maps: [about(C, { rot: Math.PI / 6, k: 0.66 })], gens: 5 };
  }
}

/** The sixfold mirror a mandala stroke is drawn with. */
const MIRROR: readonly Mat[] = Array.from({ length: 12 }, (_, i) => about(C, { rot: (Math.floor(i / 2) * Math.PI) / 3, k: 1, flip: i % 2 === 1 }));

/** The copies of generation `gen`: every product of `gen` maps, smallest left out. */
function copies(s: DeepReadonly<Stroke>, gen: number): Mat[] {
  let level: Mat[] = [ID];
  const L = s.points.reduce((acc, p, i) => acc + (i === 0 ? 0 : dist(s.points[i - 1] ?? p, p)), 0);
  for (let g = 0; g < gen; g++) {
    const next: Mat[] = [];
    for (const m of level) for (const n of s.maps) {
      const c = mul(m, n);
      if (scaleOf(c) * L > 7 && scaleOf(c) * WEIGHT > 0.9) next.push(c);
    }
    level = next.slice(0, MAX_COPIES);
  }
  return level;
}

function finish(model: DeepReadonly<Model>, frame: number): Model {
  const wet = model.wet;
  if (wet === null) return model as Model;
  if (wet.points.length < 3) return { ...(model as Model), wet: null };
  const { maps, gens } = mapsFor(wet.rule, wet.points as Vec2[]);
  const stroke: Stroke = { id: model.nextId, points: wet.points as Vec2[], colour: wet.colour, rule: wet.rule, born: frame, maps, gens, baked: 0 };
  return { ...(model as Model), wet: null, strokes: [...(model.strokes as Stroke[]), stroke], nextId: model.nextId + 1 };
}

/** Frames between chain steps: each step draws the whole sheet's picture again, so steps are batched. */
const STEP = 3;

/** Every few frames a chain step lays down each stroke's next generation that is due. */
function grow(model: DeepReadonly<Model>, frame: number): Model {
  if (frame % STEP !== 0) return model as Model;
  const due = model.strokes.filter((s) => s.baked <= s.gens && frame >= s.born + s.baked * GAP);
  if (due.length === 0) return model as Model;
  const ids = new Set(due.map((s) => s.id));
  return {
    ...(model as Model),
    steps: [...(model.steps as Piece[][]), due.map((s) => ({ stroke: s.id, gen: s.baked }))],
    strokes: model.strokes.map((s) => (ids.has(s.id) ? { ...s, baked: s.baked + 1 } : s)) as Stroke[],
  };
}

const clean = (model: DeepReadonly<Model>, palette: PaletteName): Model => ({ ...(model as Model), palette, sheet: model.sheet + 1, strokes: [], steps: [], wet: null });

// eslint-disable-next-line max-params -- TEA contract signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<P>): Model {
  switch (msg.type) {
    case "mousedown":
      u.handled("start");
      return { ...(model as Model), wet: { points: [[msg.x, msg.y]], colour: model.nextColour, rule: model.rule }, nextColour: model.nextColour + 1 };
    case "mousemove": {
      const wet = model.wet;
      if (wet === null) return model as Model;
      const last = wet.points.at(-1);
      if (last !== undefined && dist(last, [msg.x, msg.y]) < 5) return model as Model;
      u.handled("paint");
      return { ...(model as Model), wet: { ...wet, points: [...(wet.points as Vec2[]), [msg.x, msg.y]] } };
    }
    case "mouseup":
    case "mouseleave":
      if (model.wet === null) return model as Model;
      u.handled("finish");
      return finish(model, model.frame);
    case "tick":
      return grow({ ...(model as Model), frame: msg.frame }, msg.frame);
    case "keydown": {
      const n = Number(msg.key);
      const rule = RULES[n - 1];
      if (Number.isInteger(n) && rule !== undefined) {
        u.handled(`rule ${rule}`);
        return { ...(model as Model), rule };
      }
      if (msg.key === "c") { u.handled("clean sheet"); return clean(model, model.palette); }
      if (msg.key === "p") {
        const next = PALETTE_NAMES[(PALETTE_NAMES.indexOf(model.palette) + 1) % PALETTE_NAMES.length] ?? "nocturne";
        u.handled(`palette ${next}`);
        return clean(model, next);
      }
      return model as Model;
    }
    case "param":
      if (msg.name === "palette" && u.params.palette !== model.palette) return clean(model, u.params.palette);
      if (msg.name === "rule") return { ...(model as Model), rule: u.params.rule };
      return model as Model;
    case "trigger":
      if (msg.name === "clear") { u.handled("clean sheet"); return clean(model, model.palette); }
      return model as Model;
    case "keyup":
      return model as Model;
  }
}

// ── drawing ──

/** The paint for generation `gen`: the hue walks, the paint lightens and thins as it recedes. */
function paintOf(pal: Palette, colour: number, gen: number): Lch {
  const base = pal.paints[colour % pal.paints.length] ?? pal.paints[0] ?? [0.7, 0.1, 0];
  const lift = pal.dark ? 0.035 : -0.03;
  const g = Math.min(gen, 6);
  return [Math.min(0.94, Math.max(0.2, base[0] + lift * g)), base[1] * 0.96 ** g, (base[2] + g * 17 + Math.max(0, gen - 6) * 5) % 360];
}

function strokeStyle(pal: Palette, a: { colour: number; gen: number; scale: number; seed: number }): Style {
  const c = ok(paintOf(pal, a.colour, a.gen));
  // Bristle reads only when the mark is wide on screen; thin copies are ink.
  return a.scale * WEIGHT >= 6
    ? { stroke: c, weight: WEIGHT, brush: { preset: "bristle", hueJitter: 9, lightJitter: 0.07, load: 1.4 }, gesture: { seed: a.seed, pressure: "taper" } }
    : { stroke: c, weight: WEIGHT, brush: "ink", gesture: { seed: a.seed, pressure: "taper", faint: true } };
}

/** On paper, under the person's own stroke, a wet glaze a little along the hue wheel: it mixes with the paint it crosses, as watercolour. */
function glaze(pal: Palette, colour: number, seed: number): Style | undefined {
  if (pal.dark) return undefined;
  const [l, c, h] = paintOf(pal, colour, 0);
  return { stroke: ok([l, c, (h + 40) % 360]), weight: WEIGHT * 1.2, brush: { preset: "wet", color: 0.45, strength: 0.7 }, gesture: { seed, pressure: "swell" } };
}

function piece(v: View, pal: Palette, s: DeepReadonly<Stroke>, gen: number): Drawing {
  if (gen === 0) {
    const mirror = s.rule === "mandala" ? MIRROR : [ID];
    const wash = glaze(pal, s.colour, s.id * 1000);
    return mirror.map((f, j) => v.at({ matrix: f }, [
      wash !== undefined && v.curve(s.points as Vec2[], false, { ...wash, gesture: { seed: s.id * 1000 + j, pressure: "swell" } }),
      v.curve(s.points as Vec2[], false, strokeStyle(pal, { colour: s.colour, gen: 0, scale: 1, seed: s.id * 1000 + j })),
    ]));
  }
  const mats = copies(s, gen);
  const mirror = s.rule === "mandala" ? MIRROR : [ID];
  const last = gen === s.gens;
  return mats.map((m, i) => mirror.map((f, j) => {
    const at = mul(f, m);
    const sc = scaleOf(at);
    const tip = apply(at, s.points.at(-1) as Vec2);
    return [
      v.at({ matrix: at }, v.curve(s.points as Vec2[], false, strokeStyle(pal, { colour: s.colour, gen, scale: sc, seed: s.id * 1000 + i * 13 + j }))),
      last && (s.rule === "branch" || s.rule === "spiral") && [
        v.circle(tip[0], tip[1], 9, { fill: v.radialGradient(tip[0], tip[1], 9, [[0, ok(pal.bud, 0.55)], [1, ok(pal.bud, 0)]]), blend: pal.dark ? "screen" : "multiply" }),
        v.circle(tip[0], tip[1], 2.2, { fill: ok(pal.bud) }),
      ],
    ];
  }));
}

/** The sheet and the first `count` chain steps: the picture before it, plus the step's pieces. */
function chain(v: View, model: DeepReadonly<Model>, count: number): Drawing {
  const pal = PALETTES[model.palette];
  const pic = v.picture({ key: `sheet-${model.sheet}-${count}`, width: W, height: H }, () => {
    const step = model.steps[count - 1];
    if (step === undefined) return [v.background(ok(pal.ground)), ground(v, pal, model.sheet)];
    return [chain(v, model, count - 1), step.map((p) => {
      const s = model.strokes.find((st) => st.id === p.stroke);
      return s !== undefined && piece(v, pal, s, p.gen);
    })];
  });
  return v.place(pic, 0, 0);
}

/** The bare sheet: broad soft washes near the ground colour, a vignette, and a little paper. */
function ground(v: View, pal: Palette, sheet: number): Drawing {
  let seed = (sheet * 2654435761) >>> 0 || 7;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const lift = pal.dark ? 0.16 : 0.08;
  const washes = Array.from({ length: 9 }, () => ({ x: rnd() * W, y: rnd() * H, len: 200 + rnd() * 380, ang: rnd() * Math.PI, dh: (rnd() - 0.5) * 90, dl: (rnd() - 0.5) * lift }));
  const [gl, gc, gh] = pal.ground;
  return v.paper({ scale: 3, contrast: 0.5 }, [
    washes.map((w, i) => v.line(w.x - Math.cos(w.ang) * w.len / 2, w.y - Math.sin(w.ang) * w.len / 2, w.x + Math.cos(w.ang) * w.len / 2, w.y + Math.sin(w.ang) * w.len / 2, {
      stroke: ok([gl + w.dl, gc * (pal.dark ? 2.2 : 1.6), gh + w.dh]), weight: 160 + i * 12, brush: { preset: "airbrush", opacity: pal.dark ? 0.5 : 0.35 }, gesture: { seed: i, pressure: "swell", faint: true },
    })),
    v.rect(0, 0, W, H, {
      fill: v.radialGradient(C[0], C[1] * 0.9, 640, [[0, ok(pal.grain, 0.0)], [0.7, ok(pal.grain, 0.35)], [1, ok(pal.grain, 0.8)]]),
      effects: { paper: 0.5 },
    }),
  ]);
}

function live(v: View, model: DeepReadonly<Model>): Drawing {
  const wet = model.wet;
  if (wet === null || wet.points.length < 2) return null;
  const pal = PALETTES[model.palette];
  const style = strokeStyle(pal, { colour: wet.colour, gen: 0, scale: 1, seed: model.nextId * 1000 });
  const mirror = wet.rule === "mandala" ? MIRROR : [ID];
  return mirror.map((f) => v.at({ matrix: f }, v.curve(wet.points as Vec2[], false, style)));
}

export function draw(v: View, model: DeepReadonly<Model>, _p: ParamValues<P>): RootDrawing {
  const pal = PALETTES[model.palette];
  return [
    chain(v, model, model.steps.length),
    live(v, model),
    v.text(`${model.rule} · ${model.palette}    1–4 rule   p palette   c clean sheet`, { x: 14, y: H - 12 }, { size: 12, valign: "bottom", fill: ok(pal.dark ? [0.85, 0.03, 90] : [0.35, 0.03, 60], 0.55), font: "Georgia, serif", style: "italic" }),
  ];
}
