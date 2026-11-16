// Thimble Quay: a busy little canal town, painted in ink and watercolour. The day
// passes (dusk falls, windows and lamps come on), the tram comes and goes, folk
// walk the pavements, and nearly everything answers a click: the clock tower's
// bell scatters the pigeons, the baker brings out buns (and the cat follows), the
// mouse lets go of her balloon, the frog rows and the ducks scatter, windows and
// lamps switch, the mill spins, and after dark the sky takes fireworks.
//
// The still town is painted once into pictures (town-tea.ts); the folk are pose
// pictures (folk-tea.ts); live-tea.ts places it all each frame.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, RootDrawing, SampleName, Util, View, Voice } from "@ianbicking/canvas-loop";
import { BALLOON_AT_REST, H, LAMPS, W, WINDOWS, burn, stepBalloon } from "./layout-tea.js";
import { paintScene } from "./live-tea.js";
import { CLIMB, LASTS, type Model, type Sky, type Target, type Who, hitId, hitTest, nightOf } from "./model-tea.js";

export const params = {
  hour: { type: "number", min: 0, max: 24, step: 0.25, default: 17.5, label: "Time of day", hint: "hours; dusk falls around seven" },
  pace: { type: "number", min: 0, max: 4, step: 0.5, default: 1, label: "Day speed", hint: "hours every 10 seconds; 0 stops the clock" },
  weather: { type: "select", options: ["fair", "rain", "snow"] as const, default: "fair", label: "Weather" },
  folk: { type: "number", min: 0, max: 9, step: 1, default: 9, label: "Townsfolk out" },
  hints: { type: "boolean", default: true, label: "Show what to click" },
  fireworks: { type: "trigger", label: "Fireworks!" },
} as const satisfies ParamsDecl;
type P = typeof params;

export const canvas = { width: W, height: H };
const SKIES: readonly Sky[] = params.weather.options;
export type { Model };

export function init(u: Util<P>): Model {
  return {
    frame: 0,
    clock: u.params.hour,
    mouse: null,
    flipped: WINDOWS.map(() => false),
    lampFlipped: LAMPS.map(() => false),
    bell: null, bakery: null, balloon: null, rowing: null, ducks: null, tram: null, petals: null, cafe: null, fish: null,
    hotAir: BALLOON_AT_REST,
    reactions: [],
    sky: { kind: u.params.weather, prev: "fair", at: -10000 },
    thunder: null,
    millAngle: 0, millSpin: 0,
    rockets: [],
    voices: [],
    count: 0,
  };
}

/** Sounds older than this are finished and no longer returned. */
const KEEP = 600;

interface Sound {
  /** Frames after the next one. */
  readonly delay?: number;
  readonly name?: SampleName;
  readonly variant?: number;
  readonly rate?: number;
  readonly gain?: number;
  readonly note?: { instrument: "marimba" | "kalimba" | "bell" | "epiano"; note: string };
  /** A burst of noise this many seconds long (rain, wind, a whoosh). */
  readonly noise?: number;
}

function hear(model: DeepReadonly<Model>, sounds: readonly Sound[]): Pick<Model, "voices" | "count"> {
  const fresh = sounds.map((s, k): Voice => {
    const id = `v${model.count + k}`;
    const at = model.frame + 1 + (s.delay ?? 0);
    const gain = s.gain ?? 0.35;
    if (s.note) return { id, at, gain, kind: "note", instrument: s.note.instrument, note: s.note.note };
    if (s.noise !== undefined) return { id, at, gain, kind: "noise", duration: s.noise };
    return { id, at, gain, kind: "sample", name: s.name ?? "click", variant: s.variant ?? 0, rate: s.rate ?? 1 };
  });
  return { voices: [...model.voices.filter((vc) => model.frame - vc.at < KEEP), ...fresh], count: model.count + fresh.length };
}

const idle = (start: number | null, frame: number, lasts: number): boolean => start === null || frame - start >= lasts;

function launch(model: DeepReadonly<Model>, u: Util<P>, at: { x: number; y: number; delay: number }): Pick<Model, "rockets" | "voices" | "count"> {
  const r = { at: model.frame + 1 + at.delay, x: at.x, y: at.y, hue: Math.floor(u.random() * 360) };
  return {
    rockets: [...model.rockets.filter((k) => model.frame - k.at < LASTS.rocket), r],
    ...hear(model, [
      { name: "rise", variant: model.count, gain: 0.12, rate: 1.4, delay: at.delay },
      { name: "pop", variant: model.count, gain: 0.4, rate: 0.6 + u.random() * 0.3, delay: at.delay + CLIMB },
    ]),
  };
}

/** What each of the folk says when clicked. */
function folkSounds(who: Who, u: Util<P>): Sound[] {
  switch (who) {
    case "heron": return [{ name: "page", variant: 0, gain: 0.3 }, { name: "page", variant: 1, gain: 0.25, delay: 8 }];
    case "goose": return [{ name: "question", variant: 0, gain: 0.3, rate: 0.6 }, { name: "question", variant: 1, gain: 0.28, rate: 0.55, delay: 12 }];
    case "mole": return [{ name: "page", variant: 1, gain: 0.32, rate: 0.9 }, { name: "pop", variant: 0, gain: 0.2, delay: 6 }];
    case "badger": return [0, 2, 4, 2].map((st, k): Sound => ({ note: { instrument: "kalimba", note: u.scaleNote(st + 5) }, gain: 0.22, delay: k * 9 }));
    case "hedgehog": return [{ noise: 0.35, gain: 0.08 }, { noise: 0.35, gain: 0.07, delay: 14 }, { name: "thud", variant: 1, gain: 0.2, delay: 4 }];
    case "mouse": return [{ name: "pop", variant: 1, gain: 0.28, rate: 1.4 }, { note: { instrument: "kalimba", note: u.scaleNote(10) }, gain: 0.2, delay: 6 }];
    case "otter": return [{ name: "clink", variant: 1, gain: 0.3 }, { name: "clink", variant: 3, gain: 0.25, delay: 10 }];
    case "cyclist": return [{ name: "ding", variant: 3, gain: 0.3, rate: 1.9 }, { name: "ding", variant: 3, gain: 0.28, rate: 1.9, delay: 9 }];
    case "cart": return [{ name: "knock", variant: 0, gain: 0.3 }, { name: "knock", variant: 2, gain: 0.22, delay: 22 }, { name: "knock", variant: 3, gain: 0.16, delay: 38 }];
  }
}

// eslint-disable-next-line complexity -- one case per thing in the town; each is a line or two
function press(model: DeepReadonly<Model>, target: Target, u: Util<P>): Model {
  const f = model.frame;
  const m: Model = { ...model, flipped: [...model.flipped], lampFlipped: [...model.lampFlipped], rockets: [...model.rockets], voices: [...model.voices] };
  switch (target.kind) {
    case "folk": {
      const last = model.reactions.find((r) => r.who === target.who);
      if (last && f - last.at < 40) return m;
      return { ...m, reactions: [...model.reactions.filter((r) => f - r.at < LASTS.reaction && r.who !== target.who), { who: target.who, at: f }], ...hear(model, folkSounds(target.who, u)) };
    }
    case "hotair":
      if (model.hotAir.fired !== null && f - model.hotAir.fired < 12) return m;
      {
        const hotAir = burn(model.hotAir, f);
        const sounds: Sound[] = hotAir.sputter
          ? [{ noise: 0.12, gain: 0.12 }, { name: "click", variant: 2, gain: 0.2, rate: 0.6, delay: 7 }, { noise: 0.1, gain: 0.1, delay: 14 }, { name: "click", variant: 4, gain: 0.16, rate: 0.55, delay: 22 }]
          : [{ noise: 0.9, gain: 0.16 }, { name: "rise", variant: 2, gain: 0.18, rate: 0.6, delay: 4 }];
        return { ...m, hotAir, ...hear(model, sounds) };
      }
    case "window":
      return { ...m, flipped: m.flipped.map((b, i) => (i === target.i ? !b : b)), ...hear(model, [{ name: "toggle", variant: target.i, gain: 0.3 }]) };
    case "lamp":
      return { ...m, lampFlipped: m.lampFlipped.map((b, i) => (i === target.i ? !b : b)), ...hear(model, [{ name: "click", variant: target.i, gain: 0.3 }]) };
    case "bell":
      if (!idle(model.bell, f, 200)) return m;
      return { ...m, bell: f, ...hear(model, [0, 1, 2].flatMap((k): Sound[] => [{ name: "bell", variant: k, gain: 0.32, delay: k * 46, rate: 0.8 }]).concat([{ name: "page", variant: 1, gain: 0.25, delay: 10 }, { name: "page", variant: 0, gain: 0.2, delay: 16 }])) };
    case "bakery":
      if (!idle(model.bakery, f, LASTS.bakery)) return m;
      return { ...m, bakery: f, ...hear(model, [{ name: "creak", variant: 0, gain: 0.3 }, { name: "ding", variant: 2, gain: 0.3, delay: 40 }]) };
    case "tram":
      return { ...m, tram: f, ...hear(model, [{ name: "ding", variant: 0, gain: 0.32, rate: 1.25 }, { name: "ding", variant: 1, gain: 0.3, rate: 1.25, delay: 12 }, { name: "zap", variant: 0, gain: 0.08, delay: 2 }]) };
    case "balloon":
      return { ...m, balloon: f, ...hear(model, [{ name: "rise", variant: 0, gain: 0.25 }]) };
    case "boat":
      return { ...m, rowing: f, ducks: idle(model.ducks, f, LASTS.ducks) ? f + 10 : model.ducks, ...hear(model, [{ name: "drop", variant: 0, gain: 0.3 }, { name: "drop", variant: 1, gain: 0.25, delay: 24 }, { name: "question", variant: 0, gain: 0.2, rate: 1.3, delay: 14 }, { name: "question", variant: 2, gain: 0.18, rate: 1.4, delay: 22 }]) };
    case "ducks":
      return { ...m, ducks: f, ...hear(model, [{ name: "question", variant: 1, gain: 0.22, rate: 1.3 }, { name: "question", variant: 3, gain: 0.2, rate: 1.45, delay: 8 }, { name: "drop", variant: 2, gain: 0.25, delay: 4 }]) };
    case "mill":
      return { ...m, millSpin: Math.min(0.3, model.millSpin + 0.16), ...hear(model, [{ name: "creak", variant: 1, gain: 0.3, rate: 0.85 }]) };
    case "cafe":
      if (!idle(model.cafe, f, 120)) return m;
      return { ...m, cafe: f, ...hear(model, [{ name: "clink", variant: 0, gain: 0.3, delay: 20 }, { name: "clink", variant: 2, gain: 0.25, delay: 34 }, ...[0, 2, 4].map((s, k): Sound => ({ note: { instrument: "marimba", note: u.scaleNote(s + 5) }, gain: 0.22, delay: 50 + k * 9 }))]) };
    case "florist":
      if (!idle(model.petals, f, 120)) return m;
      return { ...m, petals: f, ...hear(model, [0, 1, 2, 3, 4, 5].map((s): Sound => ({ note: { instrument: "kalimba", note: u.scaleNote(s + 3) }, gain: 0.2, delay: s * 6 }))) };
    case "fish":
      if (!idle(model.fish, f, LASTS.fish + 20)) return m;
      return { ...m, fish: f, ...hear(model, [{ name: "drop", variant: 3, gain: 0.3, delay: 2 }, { name: "drop", variant: 1, gain: 0.35, delay: LASTS.fish - 6 }]) };
    case "books": {
      const lit = WINDOWS.filter((w) => w.b === 1).map((w) => w.i);
      return { ...m, flipped: m.flipped.map((b, i) => (lit.includes(i) ? !b : b)), ...hear(model, [{ name: "page", variant: 0, gain: 0.3 }]) };
    }
    case "house":
      return m;
    case "sky":
      if (nightOf(model.clock) <= 0.4) return m;
      return { ...m, ...launch(model, u, { x: model.mouse?.[0] ?? W / 2, y: Math.max(40, model.mouse?.[1] ?? 100), delay: 0 }) };
  }
}

function tick(model: DeepReadonly<Model>, frame: number, u: Util<P>): Model {
  const pace = u.params.pace;
  const clock = (model.clock + pace / 600 + 24) % 24;
  const wind = u.params.weather === "rain" ? 0.03 : 0.012;
  let next: Model = { ...model, frame, clock, hotAir: stepBalloon(model.hotAir), millAngle: (model.millAngle + wind + model.millSpin) % (Math.PI * 2), millSpin: model.millSpin * 0.985 };
  // The balloon pops when it reaches the top of the sky.
  if (model.balloon !== null && frame - model.balloon === LASTS.balloonPop) next = { ...next, ...hear(next, [{ name: "pop", variant: 1, gain: 0.4 }]) };
  if (model.balloon !== null && frame - model.balloon >= LASTS.balloonBack) next = { ...next, balloon: null };
  return rainSounds(next, frame, u);
}

/** While it rains: a soft hiss of rain, a patter of drops, and now and then lightning and thunder. */
function rainSounds(model: Model, frame: number, u: Util<P>): Model {
  if (model.sky.kind !== "rain" || frame - model.sky.at < 30) return model;
  const sounds: Sound[] = [];
  if (frame % 40 === 0) sounds.push({ noise: 1.6, gain: 0.05 });
  if (u.random() < 0.06) sounds.push({ name: "drop", variant: Math.floor(u.random() * 4), gain: 0.04 + u.random() * 0.03, rate: 0.9 + u.random() * 0.5 });
  let next = model;
  const first = frame - model.sky.at === 100;
  if (first || ((model.thunder === null || frame - model.thunder > 420) && frame - model.sky.at > 100 && u.random() < 1 / 360)) {
    next = { ...next, thunder: frame };
    sounds.push({ name: "thud", variant: 0, gain: 0.45, rate: 0.5, delay: 26 }, { noise: 2.8, gain: 0.16, delay: 24 }, { name: "thud", variant: 2, gain: 0.3, rate: 0.55, delay: 44 });
  }
  return sounds.length === 0 ? next : { ...next, ...hear(next, sounds) };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<P>): Model {
  switch (msg.type) {
    case "tick":
      return tick(model, msg.frame, u);
    case "mousemove":
      return { ...model, mouse: [msg.x, msg.y] };
    case "mousedown": {
      const at: Model = { ...model, mouse: [msg.x, msg.y] };
      const hit = hitTest(at, msg.x, msg.y, u.params.folk);
      if (!hit) return at;
      if (hit.target.kind === "sky" && nightOf(model.clock) <= 0.4) return at;
      u.handled(hitId(hit.target));
      return press(at, hit.target, u);
    }
    case "mouseup":
    case "keydown":
    case "keyup":
      return model;
    case "param":
      if (msg.name === "hour" && typeof msg.value === "number") return { ...model, clock: msg.value };
      if (msg.name === "weather") {
        const kind = SKIES.find((k) => k === msg.value);
        if (kind === undefined || kind === model.sky.kind) return model;
        // Rain to snow keeps the clouds where they are.
        const stays = kind !== "fair" && model.sky.kind !== "fair";
        return { ...model, sky: { kind, prev: model.sky.kind, at: stays ? model.sky.at : model.frame } };
      }
      return model;
    case "trigger": {
      if (msg.name !== "fireworks") return model;
      u.handled("fireworks");
      let next = model;
      for (let k = 0; k < 5; k++) next = { ...next, ...launch(next, u, { x: 120 + u.random() * (W - 240), y: 50 + u.random() * 110, delay: k * 26 }) };
      return next;
    }
  }
}

export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.voices;
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<P>): RootDrawing {
  return paintScene(v, model, { weather: p.weather, folk: p.folk, hints: p.hints });
}

