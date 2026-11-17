// Mochi Must Not Fall: a lane-defense game painted in ink on rice paper.
// Haunted household things (hopping umbrellas, runaway sandals, lantern ghosts
// and grumpy iron kettles) march across a garden scroll toward the New Year
// mochi, beside which a cat is asleep. You paint defenders with ink: inkstones
// that well up more ink, cranes that flick ink blots, folding screens that take
// ages to chew through, paper tigers that swat, and a red seal that stamps flat
// a three-by-three square.
//
// rules-tea.ts is the game (pure); cast-tea.ts and board-tea.ts paint the
// pictures; scene-tea.ts places them each frame.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, RootDrawing, SampleName, Util, View, Voice } from "@ianbicking/canvas-loop";
import { AGAIN, type Cue, DEFS, DEF_KINDS, type DefKind, type Game, H, W, cardAt, cellAt, collect, dropHit, newGame, place, step } from "./rules-tea.js";
import { type Shake, paintScene } from "./scene-tea.js";

export const params = {
  speed: { type: "number", min: 1, max: 3, step: 1, default: 1, label: "Game speed" },
  hints: { type: "boolean", default: true, label: "Show hints" },
  restart: { type: "trigger", label: "Start over" },
} as const satisfies ParamsDecl;
type P = typeof params;

export const canvas = { width: W, height: H };

export interface Model {
  readonly frame: number;
  readonly game: Game;
  readonly mouse: readonly [number, number] | null;
  readonly shake: Shake;
  readonly voices: readonly Voice[];
  readonly count: number;
  /** The frame each kind of sound last played, so busy moments do not pile up. */
  readonly heard: Readonly<Record<string, number>>;
}

export function init(): Model {
  return { frame: 0, game: newGame({ type: "title" }), mouse: null, shake: { at: -100, amp: 0 }, voices: [], count: 0, heard: {} };
}

// --- Sound ------------------------------------------------------------------------------

interface Sound {
  readonly delay?: number;
  readonly name?: SampleName;
  readonly variant?: number;
  readonly rate?: number;
  readonly gain?: number;
  readonly note?: { instrument: "marimba" | "kalimba" | "bell" | "epiano"; note: string };
  /** Skip it if a sound with this tag played within `gap` frames. */
  readonly tag?: string;
  readonly gap?: number;
}

const KEEP = 400;

function hear(m: DeepReadonly<Model>, sounds: readonly Sound[]): Pick<Model, "voices" | "count" | "heard"> {
  const heard: Record<string, number> = { ...m.heard };
  const kept = sounds.filter((s) => {
    if (s.tag === undefined) return true;
    const last = heard[s.tag];
    if (last !== undefined && m.frame - last < (s.gap ?? 6)) return false;
    heard[s.tag] = m.frame;
    return true;
  });
  const fresh = kept.map((s, k): Voice => {
    const id = `v${m.count + k}`;
    const at = m.frame + 1 + (s.delay ?? 0);
    const gain = s.gain ?? 0.3;
    if (s.note) return { id, at, gain, kind: "note", instrument: s.note.instrument, note: s.note.note };
    return { id, at, gain, kind: "sample", name: s.name ?? "click", variant: s.variant ?? 0, rate: s.rate ?? 1 };
  });
  return { voices: [...m.voices.filter((vc) => m.frame - vc.at < KEEP), ...fresh], count: m.count + fresh.length, heard };
}

function cueSounds(c: Cue, u: Util<P>, n: number): Sound[] {
  switch (c.kind) {
    case "shot": return [{ name: "pop", variant: n, gain: 0.1, rate: 1.7, tag: "shot", gap: 9 }];
    case "hit": return c.foe === "kettle"
      ? [{ name: "metal", variant: n, gain: 0.16, rate: 1.1, tag: "hit", gap: 5 }]
      : [{ name: "thud", variant: n, gain: 0.2, rate: 1.25, tag: "hit", gap: 5 }];
    case "defeat": return [{ name: "pop", variant: n, gain: 0.3, rate: 0.8 }, { note: { instrument: "marimba", note: u.scaleNote(3 + (c.n % 8)) }, gain: 0.22, delay: 3 }];
    case "swipe": return [{ name: "chop", gain: 0.28, rate: 1.4, tag: "swipe", gap: 6 }];
    case "stamp": return [{ name: "thud", variant: 0, gain: 0.55, rate: 0.55 }, { name: "card", variant: 1, gain: 0.4, rate: 0.7 }, { name: "chop", gain: 0.3, rate: 0.8, delay: 2 }];
    case "chomp": return [{ name: "knock", variant: n, gain: 0.14, rate: 1.5, tag: "chomp", gap: 14 }];
    case "eaten": return [{ name: "fall", variant: n, gain: 0.28 }];
    case "drop": return [{ name: "drop", variant: n, gain: 0.2, tag: "drop", gap: 10 }];
    case "wave": return [{ name: "bell", variant: 0, gain: 0.32, rate: 0.7 }, { name: "bell", variant: 1, gain: 0.26, rate: 0.7, delay: 40 }];
    case "won": return [{ name: "fanfare", variant: 0, gain: 0.4 }, ...[0, 2, 4, 7].map((st, k): Sound => ({ note: { instrument: "bell", note: u.scaleNote(st + 5) }, gain: 0.2, delay: 30 + k * 12 }))];
    case "lost": return [{ name: "error", variant: 0, gain: 0.3 }, { name: "fall", variant: 1, gain: 0.35, rate: 0.6, delay: 10 }, { name: "question", variant: 2, gain: 0.3, rate: 0.7, delay: 50 }];
    case "arrive": return c.foe === "kettle" ? [{ name: "step-wood", variant: n, gain: 0.12, rate: 0.7, tag: "arrive", gap: 30 }] : [];
  }
}

// --- Update -----------------------------------------------------------------------------

function tick(m: DeepReadonly<Model>, frame: number, u: Util<P>): Model {
  let game: Game = m.game;
  let shake = m.shake;
  const sounds: Sound[] = [];
  const steps = m.game.mode.type === "play" ? Math.max(1, Math.round(u.params.speed)) : 1;
  for (let i = 0; i < steps; i++) {
    const r = step(game);
    game = r.game;
    if (r.shake > 0) shake = { at: frame, amp: r.shake };
    for (const c of r.cues) {
      if (c.kind === "defeat" || c.kind === "eaten") shake = frame - shake.at < 6 && shake.amp > 3 ? shake : { at: frame, amp: c.kind === "defeat" ? 3 : 4 };
      sounds.push(...cueSounds(c, u, m.count + sounds.length));
    }
  }
  const next: Model = { ...m, frame, game, shake };
  return sounds.length === 0 ? next : { ...next, ...hear(next, sounds) };
}

function pick(m: DeepReadonly<Model>, kind: DefKind, u: Util<P>): Model {
  const g = m.game;
  if (g.selected === kind) return { ...m, game: { ...g, selected: null }, ...hear(m, [{ name: "close", variant: 1, gain: 0.2 }]) };
  if (g.ink < DEFS[kind].cost || g.t < g.ready[kind]) return { ...m, ...hear(m, [{ name: "error", variant: 1, gain: 0.18 }]) };
  u.handled(`pick-${kind}`);
  return { ...m, game: { ...g, selected: kind }, ...hear(m, [{ name: "select", variant: DEF_KINDS.indexOf(kind), gain: 0.25 }]) };
}

function press(m: DeepReadonly<Model>, x: number, y: number, u: Util<P>): Model {
  const g = m.game;
  switch (g.mode.type) {
    case "title":
      if (x < AGAIN.x || x > AGAIN.x + AGAIN.w || y < AGAIN.y || y > AGAIN.y + AGAIN.h) return m;
      u.handled("begin");
      return { ...m, game: newGame({ type: "play" }), ...hear(m, [{ name: "page", variant: 0, gain: 0.3 }]) };
    case "won":
    case "lost":
      if (g.t - g.mode.at < 30 || x < AGAIN.x || x > AGAIN.x + AGAIN.w || y < AGAIN.y || y > AGAIN.y + AGAIN.h) return m;
      u.handled("again");
      return { ...m, game: newGame({ type: "play" }), shake: { at: -100, amp: 0 }, ...hear(m, [{ name: "page", variant: 1, gain: 0.3 }]) };
    case "play":
      break;
  }
  const drop = dropHit(g, x, y);
  if (drop) {
    u.handled("catch-ink");
    return { ...m, game: collect(g, drop.id), ...hear(m, [{ note: { instrument: "kalimba", note: u.scaleNote(5 + (m.count % 5)) }, gain: 0.25 }]) };
  }
  const card = cardAt(x, y);
  if (card !== null) return pick(m, card, u);
  const cell = cellAt(x, y);
  if (cell === null || g.selected === null) return m;
  const r = place(g, g.selected, cell.col, cell.row);
  if (!r.ok) return { ...m, ...hear(m, [{ name: "error", variant: 2, gain: 0.18 }]) };
  u.handled(`place-${g.selected}`);
  return { ...m, game: r.game, ...hear(m, [{ name: "card", variant: m.count, gain: 0.32 }, { name: "pop", variant: 1, gain: 0.2, rate: 1.2, delay: 4 }]) };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<P>): Model {
  switch (msg.type) {
    case "tick":
      return tick(model, msg.frame, u);
    case "mousemove":
      return { ...model, mouse: [msg.x, msg.y] };
    case "mouseleave":
      return { ...model, mouse: null };
    case "mousedown":
      return press({ ...model, mouse: [msg.x, msg.y] }, msg.x, msg.y, u);
    case "mouseup":
    case "keyup":
      return model;
    case "keydown": {
      if (model.game.mode.type !== "play") return msg.key === "Enter" || msg.key === " " ? press(model, AGAIN.x + 1, AGAIN.y + 1, u) : model;
      const i = Number.parseInt(msg.key, 10);
      const kind = DEF_KINDS[i - 1];
      if (kind !== undefined) return pick(model, kind, u);
      if (msg.key === "Escape") return { ...model, game: { ...model.game, selected: null } };
      return model;
    }
    case "param":
      return model;
    case "trigger":
      if (msg.name !== "restart") return model;
      u.handled("restart");
      return { ...model, game: newGame({ type: "play" }), shake: { at: -100, amp: 0 } };
  }
}

export function sound(model: DeepReadonly<Model>): readonly Voice[] {
  return model.voices;
}

export function activity(model: DeepReadonly<Model>): Record<string, unknown> {
  const g = model.game;
  return { mode: g.mode.type, wave: g.wave + 1, ink: g.ink, defenders: g.defenders.length, foes: g.foes.length, defeated: g.defeated };
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<P>): RootDrawing {
  return paintScene(v, { frame: model.frame, game: model.game, mouse: model.mouse, shake: model.shake }, { hints: p.hints });
}
