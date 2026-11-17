// Sounds chosen by meaning, and the rules of voices: a tapped bar plays a
// marimba note from `u.scaleNote`, so any order is in tune; a ball dropped from
// the sky lands with a `knock`, a different take each time; playing every bar
// once earns a `chime`. Each sound gets a new id from a counter in the model.
// It starts at `model.frame + 1`: the model holds the last tick's frame, so
// that is the frame of the click or the landing. Linked from TEA.md "Sound".
import type { DeepReadonly, Drawing, Msg, RootDrawing, Util, View, Voice } from "@ianbicking/canvas-loop";

export const canvas = { width: 400, height: 260 };

const BARS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const FLOOR = 230;
const GRAVITY = 0.35;
/** A sound is returned for this many frames after it starts; by then it has finished. */
const KEEP = 240;

interface Heard {
  n: number;
  at: number;
  kind: "bar" | "knock" | "chime";
  /** The bar played, for a "bar" sound. */
  bar: number;
  note: string;
}

interface Ball {
  x: number;
  y: number;
  vy: number;
}

export interface Model {
  frame: number;
  count: number;
  heard: readonly Heard[];
  played: readonly number[];
  balls: readonly Ball[];
}

export function init(_u: Util): Model {
  return { frame: 0, count: 0, heard: [], played: [], balls: [] };
}

/** The model with one more sound under a new id, starting this frame (the model holds the last tick's). */
function hear(model: DeepReadonly<Model>, heardNow: Pick<Heard, "kind" | "bar" | "note">): Model {
  const heard = [...model.heard.filter((h) => model.frame - h.at < KEEP), { ...heardNow, n: model.count, at: model.frame + 1 }];
  return { ...model, count: model.count + 1, heard };
}

function playBar(model: DeepReadonly<Model>, bar: number, u: Util): Model {
  const next = { ...hear(model, { kind: "bar", bar, note: u.scaleNote(bar) }), played: model.played.includes(bar) ? model.played : [...model.played, bar] };
  const finished = next.played.length === BARS.length && model.played.length < BARS.length;
  return finished ? hear(next, { kind: "chime", bar: -1, note: "" }) : next;
}

function tick(model: DeepReadonly<Model>, frame: number): Model {
  const landed = model.balls.filter((b) => b.y + b.vy >= FLOOR - 6);
  const falling = model.balls.filter((b) => b.y + b.vy < FLOOR - 6).map((b) => ({ ...b, y: b.y + b.vy, vy: b.vy + GRAVITY }));
  // Hear the landings before the model takes this tick's frame, so a knock starts on the frame the ball lands.
  const heard = landed.reduce<Model>((m) => hear(m, { kind: "knock", bar: -1, note: "" }), { ...model, balls: falling });
  return { ...heard, frame };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return tick(model, msg.frame);
    case "mousedown": {
      const bar = BARS.find((i) => msg.targets.includes(`bar-${i}`));
      if (bar !== undefined) {
        u.handled(`bar-${bar}`);
        return playBar(model, bar, u);
      }
      if (!msg.targets.includes("sky")) return model;
      u.handled("drop");
      return { ...model, balls: [...model.balls, { x: msg.x, y: msg.y, vy: 0 }] };
    }
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.heard.map((h): Voice => {
    const id = `${h.kind}-${h.n}`;
    switch (h.kind) {
      case "bar":
        return { id, at: h.at, kind: "note", instrument: "marimba", note: h.note, gain: 0.4 };
      case "chime":
        return { id, at: h.at, kind: "sample", name: "chime", gain: 0.4 };
      case "knock":
        return { id, at: h.at, kind: "sample", name: "knock", variant: h.n, rate: 0.9 + (h.n % 3) * 0.1, gain: 0.35 };
    }
  });
}

/** One marimba bar, shorter to the right: gold while it rings, darker once played. */
function drawBar(v: View, i: number, model: DeepReadonly<Model>): Drawing {
  const ringing = model.heard.some((h) => h.kind === "bar" && h.bar === i && model.frame - h.at < 10);
  const fill = ringing ? "#f2b84b" : model.played.includes(i) ? "#b5793a" : "#8a5a2b";
  const height = 80 - i * 6;
  return v.roundRect(30 + i * 43, FLOOR - height, 40, height, 4, { fill, name: `bar-${i}` });
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  return [
    v.background("#f4efe4"),
    v.rect(0, 0, 400, FLOOR, { fill: "transparent", name: "sky" }),
    v.text("Tap a bar to play it. Tap the sky to drop a ball.", { x: 200, y: 24 }, { size: 13, align: "center", valign: "middle", fill: "#5a5040" }),
    BARS.map((i) => drawBar(v, i, model)),
    v.rect(0, FLOOR, 400, 30, { fill: "#6b4a2b" }),
    model.balls.map((ball) => v.circle(ball.x, ball.y, 5, { fill: "#3b6ea8" })),
  ];
}
