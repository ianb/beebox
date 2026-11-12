// Acorn Lane: a busy picture-book street. Every townsperson idles; click one
// and it performs its little act, sometimes setting off a neighbour.
import type { DeepReadonly, Msg, ParamValues, ParamsDecl, Util, View } from "@ianbicking/canvas-loop";
import type { Id } from "./things-tea.js";
import { CHAIN, H, IDS, W, act, boxOf, hit } from "./things-tea.js";
import { paintNightSky, paintTown } from "./town-tea.js";
import * as A from "./actors-tea.js";
import * as S from "./folk-tea.js";

export const params = {
  time: { type: "select", options: ["morning", "dusk", "night"] as const, default: "morning" },
  rain: { type: "boolean", default: false },
  reset: { type: "trigger" },
} as const satisfies ParamsDecl;

export const canvas = { width: W, height: H };

interface Cue {
  readonly id: Id;
  readonly at: number;
}

export interface Model {
  readonly frame: number;
  readonly hover: Id | "";
  readonly start: Readonly<Record<Id, number>>;
  readonly queue: readonly Cue[];
  readonly bloom: number;
}

function fresh(frame: number, u: Util<typeof params>): Model {
  // every act "started" long ago, so none is playing
  return { frame, hover: "", start: u.record(IDS, () => -100_000), queue: [], bloom: 0 };
}

export function init(u: Util<typeof params>): Model {
  return fresh(0, u);
}

/** Start an act on `id` at frame `at` unless it is already playing; queue its chain reactions. */
function begin(model: DeepReadonly<Model>, id: Id, at: number): Model {
  if (act({ frame: at, start: model.start }, id) !== null) return model;
  const chained = (CHAIN[id] ?? []).map((c) => ({ id: c.id, at: at + c.delay }));
  return {
    ...model,
    start: { ...model.start, [id]: at },
    queue: [...model.queue, ...chained],
    bloom: id === "window" ? Math.min(3, model.bloom + 1) : model.bloom,
  };
}

function tick(model: DeepReadonly<Model>, frame: number): Model {
  const due = model.queue.filter((c) => c.at <= frame);
  const rest = model.queue.filter((c) => c.at > frame);
  return due.reduce<Model>((m, c) => begin(m, c.id, frame), { ...model, frame, queue: rest });
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return tick(model, msg.frame);
    case "mousemove": {
      const id = hit(model, msg.x, msg.y) ?? "";
      return id === model.hover ? model : { ...model, hover: id };
    }
    case "mousedown": {
      const id = hit(model, msg.x, msg.y);
      if (id === null) return model;
      const at = model.frame + 1;
      if (act({ frame: at, start: model.start }, id) !== null) {
        u.handled(`${id} (busy)`);
        return model;
      }
      u.handled(id);
      return begin(model, id, at);
    }
    case "mouseup":
    case "keydown":
    case "keyup":
    case "param":
      return model;
    case "trigger":
      if (msg.name !== "reset") return model;
      u.handled("reset");
      return fresh(model.frame, u);
  }
}

const SHADE: Readonly<Record<ParamValues<typeof params>["time"], string>> = {
  morning: "",
  dusk: "#f2b48c",
  night: "#6670b0",
};

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const night = p.time === "night";
  const s: A.Scene = { ...model, night, evening: p.time !== "morning" };
  v.cache("town", () => paintTown(v));
  S.warm(v);
  // back to front
  A.chimney(v, s);
  A.flag(v, s);
  A.clockHands(v, s);
  A.windowAndGoat(v, s);
  A.owl(v, s);
  A.cat(v, s);
  A.painter(v, s);
  A.baker(v, s);
  A.mailCarrier(v, s);
  A.mailbox(v, s);
  A.hydrant(v, s);
  A.lamp(v, s);
  A.bucket(v, s);
  A.dog(v, s);
  A.grocer(v, s);
  A.duck(v, s);
  A.pigeons(v, s);
  A.snail(v, s);
  A.manhole(v, s);
  A.bus(v, s);
  if (p.rain) {
    v.noStroke();
    v.fill("rgba(90,100,130,0.25)");
    v.rect(0, 0, W, H);
  }
  const shade = SHADE[p.time];
  if (shade !== "") {
    v.blendMode("multiply");
    v.noStroke();
    v.fill(shade);
    v.rect(0, 0, W, H);
    // lights go on after the shade, with a screen blend, so they glow through it
    v.blendMode("screen");
    if (night) v.cache("night-sky", () => paintNightSky(v));
    A.lights(v, s);
    v.blendMode("normal");
  }
  if (p.rain) A.rain(v, model.frame);
  A.bubbles(v, s);
  A.hoverGlint(v, s);
  v.cursor(model.hover === "" ? "default" : "pointer");
  for (const id of IDS) {
    const b = boxOf(model, id);
    v.debugBox(id, b.x, b.y, b.w, b.h);
  }
}
