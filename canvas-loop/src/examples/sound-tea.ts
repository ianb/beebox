// Sound by meaning: instrument notes and recorded samples.
//
//   - Tap a bar: a marimba note from `u.scaleNote`, so any order sounds in tune.
//   - Tap the sky: a ball drops and lands with a `knock`, a different take each time.
//   - Play every bar once: a `chime`.
//
// `update` records each sound with a fresh id and its start frame; `sound`
// returns them as voices. See TEA.md "Sound".
import type { DeepReadonly, Msg, Util, View, Voice } from "@ianbicking/canvas-loop";

export const canvas = { width: 400, height: 260 };

const BARS = 8;
const BAR_W = 40;
const BAR_X0 = 30;
const FLOOR = 230;
const GRAVITY = 0.35;
/** Sounds older than this many frames are no longer returned (they have finished). */
const KEEP = 240;

interface Heard {
  readonly n: number;
  readonly at: number;
  readonly voice: "bar" | "knock" | "chime";
  readonly note: string;
}

interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vy: number;
}

export interface Model {
  frame: number;
  count: number;
  heard: readonly Heard[];
  played: readonly boolean[];
  balls: readonly Ball[];
  lit: readonly number[];
}

export function init(_u: Util): Model {
  return { frame: 0, count: 0, heard: [], played: Array.from({ length: BARS }, () => false), balls: [], lit: [] };
}

function barAt(x: number, y: number): number | undefined {
  if (y < 150 || y > FLOOR) return undefined;
  const i = Math.floor((x - BAR_X0) / (BAR_W + 3));
  return i >= 0 && i < BARS ? i : undefined;
}

function hear(model: DeepReadonly<Model>, heardNow: Omit<Heard, "n" | "at">): Pick<Model, "count" | "heard"> {
  const heard = [...model.heard.filter((h) => model.frame - h.at < KEEP), { ...heardNow, n: model.count, at: model.frame + 1 }];
  return { count: model.count + 1, heard };
}

function press(model: DeepReadonly<Model>, at: { x: number; y: number }, u: Util): Model {
  const bar = barAt(at.x, at.y);
  if (bar === undefined) {
    u.handled("sky");
    return { ...model, balls: [...model.balls, { x: at.x, y: at.y, vy: 0 }], heard: [...model.heard], played: [...model.played], lit: [...model.lit] };
  }
  u.handled(`bar-${bar}`);
  const played = model.played.map((p, i) => p || i === bar);
  let next: Model = { ...model, ...hear(model, { voice: "bar", note: u.scaleNote(bar) }), played, balls: [...model.balls], lit: [...model.lit, bar] };
  if (played.every(Boolean) && !model.played.every(Boolean)) next = { ...next, ...hear(next, { voice: "chime", note: "" }) };
  return next;
}

function fall(model: DeepReadonly<Model>): Model {
  let next: Model = { ...model, frame: model.frame + 1, heard: [...model.heard], played: [...model.played], balls: [], lit: model.frame % 12 === 0 ? [] : [...model.lit] };
  for (const ball of model.balls) {
    const y = ball.y + ball.vy;
    if (y < FLOOR - 8) next = { ...next, balls: [...next.balls, { x: ball.x, y, vy: ball.vy + GRAVITY }] };
    else next = { ...next, ...hear(next, { voice: "knock", note: "" }) };
  }
  return next;
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  if (msg.type === "tick") return fall(model);
  if (msg.type === "mousedown") return press(model, msg, u);
  return { ...model, heard: [...model.heard], played: [...model.played], balls: [...model.balls], lit: [...model.lit] };
}

export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.heard.map((h): Voice => {
    const id = `${h.voice}-${h.n}`;
    if (h.voice === "bar") return { id, at: h.at, kind: "note", instrument: "marimba", note: h.note, gain: 0.4 };
    if (h.voice === "chime") return { id, at: h.at, kind: "sample", name: "chime", gain: 0.4 };
    return { id, at: h.at, kind: "sample", name: "knock", variant: h.n, rate: 0.9 + (h.n % 3) * 0.1, gain: 0.35 };
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#f4efe4");
  v.text("Tap a bar to play it. Tap the sky to drop a ball.", { x: 200, y: 24 }, { size: 13, align: "center", valign: "middle", fill: "#5a5040" });
  for (let i = 0; i < BARS; i += 1) {
    const height = 80 - i * 6;
    const lit = model.lit.includes(i);
    v.roundRect(BAR_X0 + i * (BAR_W + 3), FLOOR - height, BAR_W, height, 4, { fill: lit ? "#f2b84b" : model.played[i] === true ? "#b5793a" : "#8a5a2b" });
  }
  v.rect(0, FLOOR, 400, 30, { fill: "#6b4a2b" });
  for (const ball of model.balls) v.circle(ball.x, ball.y, 8, { fill: "#3b6ea8" });
}
