// Six guitar strings to pluck. Click a string, or drag across several to
// strum. Each pluck is one sound: `update` records it with a fresh id, and
// `sound` returns the recent plucks as voices (Karplus–Strong strings). The
// drawn wobble is a decaying standing wave, not a physics simulation.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Style, View, Voice } from "@ianbicking/canvas-loop";

export const params = {
  tuning: { type: "select", options: ["standard", "open G", "DADGAD"], default: "standard", label: "Tuning", panel: false },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 380 };

type Params = ParamValues<typeof params>;

const FPS = 60;
// Seconds a pluck rings, in the sound and in the drawing.
const RING = 2.5;
const LEFT = 70;
const RIGHT = 590;
const TOP = 110;
const GAP = 40;
const GRAB = 14;

// String pitches, low to high, in Hz (drawn top to bottom: low string at the top).
const TUNINGS: Record<Params["tuning"], readonly { name: string; freq: number }[]> = {
  standard: [
    { name: "E", freq: 82.41 },
    { name: "A", freq: 110 },
    { name: "D", freq: 146.83 },
    { name: "G", freq: 196 },
    { name: "B", freq: 246.94 },
    { name: "E", freq: 329.63 },
  ],
  "open G": [
    { name: "D", freq: 73.42 },
    { name: "G", freq: 98 },
    { name: "D", freq: 146.83 },
    { name: "G", freq: 196 },
    { name: "B", freq: 246.94 },
    { name: "D", freq: 293.66 },
  ],
  DADGAD: [
    { name: "D", freq: 73.42 },
    { name: "A", freq: 110 },
    { name: "D", freq: 146.83 },
    { name: "G", freq: 196 },
    { name: "A", freq: 220 },
    { name: "D", freq: 293.66 },
  ],
};

interface Pluck {
  readonly id: number;
  readonly string: number;
  readonly at: number;
  /** 0..1 along the string, where it was plucked. */
  readonly where: number;
  readonly freq: number;
}

export interface Model {
  readonly frame: number;
  readonly plucks: readonly Pluck[];
  readonly count: number;
  /** Pointer state while dragging: the last y, to see which strings it crossed. */
  readonly dragY: number | null;
  readonly hover: number | null;
}

const stringY = (i: number): number => TOP + i * GAP;

function stringAt(y: number): number | null {
  for (let i = 0; i < 6; i += 1) if (Math.abs(y - stringY(i)) <= GRAB) return i;
  return null;
}

export function init(): Model {
  return { frame: 0, plucks: [], count: 0, dragY: null, hover: null };
}

/** Pluck the given strings now. A pluck happens on the next frame (events run before that frame's tick). */
function pluck(model: DeepReadonly<Model>, hit: { strings: readonly number[]; x: number; tuning: Params["tuning"] }): Model {
  const at = model.frame + 1;
  const where = Math.min(0.95, Math.max(0.05, (hit.x - LEFT) / (RIGHT - LEFT)));
  const added = hit.strings.map((string, i) => ({ id: model.count + i, string, at: at + i * 2, where, freq: TUNINGS[hit.tuning][string]?.freq ?? 110 }));
  const recent = model.plucks.filter((p) => model.frame - p.at < RING * FPS);
  return { ...model, plucks: [...recent, ...added], count: model.count + added.length };
}

/** Strings between two pointer heights, in the order the pointer crossed them. */
function crossed(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const y = stringY(i);
    if ((from < y && y <= to) || (to <= y && y < from)) out.push(i);
  }
  return from < to ? out : out.toReversed();
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: { params: Params }): Model {
  const tuning = u.params.tuning;
  switch (msg.type) {
    case "tick":
      return { ...model, frame: msg.frame };
    case "mousedown": {
      const hit = stringAt(msg.y);
      const next = { ...model, dragY: msg.y };
      return hit === null ? next : { ...pluck(model, { strings: [hit], x: msg.x, tuning }), dragY: msg.y };
    }
    case "mousemove": {
      const hover = stringAt(msg.y);
      if (model.dragY === null) return hover === model.hover ? model : { ...model, hover };
      const strings = crossed(model.dragY, msg.y);
      const next = strings.length === 0 ? { ...model } : pluck(model, { strings, x: msg.x, tuning });
      return { ...next, dragY: msg.y, hover };
    }
    case "mouseup":
      return { ...model, dragY: null };
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

/** Every recent pluck is a voice; its id never repeats, so each pluck sounds once. */
export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.plucks.map((p) => ({
    id: `pluck-${p.id}`,
    at: p.at,
    kind: "pluck",
    freq: p.freq,
    decay: RING,
    // Plucked near the bridge sounds brighter.
    brightness: 0.35 + 0.5 * Math.abs(p.where - 0.5),
    gain: 0.35,
  }));
}

// ── drawing ──────────────────────────────────────────────────────────

const WOOD = "#7a4a26";
const NUT: Style = { fill: "#efe6d2", stroke: "#3b2a1a", weight: 1 };
const LABEL = { size: 15, fill: "#f5ead6", align: "center", valign: "middle", style: "bold" } as const;

function backdrop(v: View): void {
  v.background("#2b1d14");
  v.roundRect(30, 70, 580, 260, 18, { fill: v.linearGradient(0, 70, 0, 330, [[0, "#8a5a32"], [0.5, WOOD], [1, "#5e3719"]]) });
  // Grain: a few long brushed strokes.
  for (let i = 0; i < 9; i += 1) {
    const y = 84 + i * 28;
    v.curve([[40, y], [220, y + 6], [420, y - 5], [600, y + 3]], false, { stroke: "rgba(40, 20, 8, 0.25)", weight: 6, brush: "wash", gesture: { seed: i, faint: true } });
  }
  v.rect(LEFT - 14, 80, 14, 240, NUT);
  v.rect(RIGHT, 80, 10, 240, { ...NUT, fill: "#d9cdb5" });
  for (const x of [190, 310, 420, 515]) v.line(x, 82, x, 318, { stroke: "rgba(225, 210, 180, 0.35)", weight: 2 });
  v.text("Pluck a string, or drag across them to strum", { x: 320, y: 30 }, { size: 18, fill: "#f5ead6", align: "center", valign: "middle" });
  v.paperTexture(0.5);
}

/** How far the string is displaced at `x` now: a decaying standing wave from each recent pluck. */
function displacement(model: DeepReadonly<Model>, string: number, x: number): number {
  let sum = 0;
  for (const p of model.plucks) {
    if (p.string !== string || p.at > model.frame) continue;
    const t = (model.frame - p.at) / FPS;
    if (t > RING) continue;
    const s = (x - LEFT) / (RIGHT - LEFT);
    // Shape of the pull, then a slow visible wobble (the real string vibrates far faster).
    const shape = s < p.where ? s / p.where : (1 - s) / (1 - p.where);
    sum += 9 * shape * Math.exp((-3 * t) / RING) * Math.cos(2 * Math.PI * (7 + string) * t);
  }
  return sum;
}

export function draw(v: View, model: DeepReadonly<Model>, p: Params): void {
  v.cache("backdrop", () => backdrop(v));
  v.control("tuning", { x: 470, y: 340, w: 140, h: 28, size: 14 });
  v.text("Tuning", { x: 460, y: 354 }, { size: 14, fill: "#f5ead6", align: "right", valign: "middle" });
  const tuning = TUNINGS[p.tuning];
  for (let i = 0; i < 6; i += 1) {
    const y = stringY(i);
    const points: [number, number][] = [];
    for (let k = 0; k <= 32; k += 1) {
      const x = LEFT + ((RIGHT - LEFT) * k) / 32;
      points.push([x, y + displacement(model, i, x)]);
    }
    const lit = model.hover === i;
    const weight = 3.4 - i * 0.45;
    v.curve(points, false, { stroke: "rgba(0, 0, 0, 0.35)", weight: weight + 2 });
    v.curve(points, false, { stroke: lit ? "#fff4c8" : i < 3 ? "#c9a46a" : "#dcdcdc", weight });
    v.text(tuning[i]?.name ?? "", { x: 42, y }, LABEL);
  }
}
