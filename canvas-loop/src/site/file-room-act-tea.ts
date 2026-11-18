// What the clerk does at each moment: how high they stand, how far the drawer
// is out, where each hand goes and where the card is. Taking a card: the drawer
// comes out, one arm reaches into the row, one card rises out of it, they hold
// it up and read it, tuck it in front and push the drawer shut. Filing is the
// same in reverse: the card is lowered into a gap in the row. Everything is a
// function of the frames since arriving at the stop; the card is held by the
// hand (`mode: "hand"`) in every frame except when it is dropped.
import type { Vec2 } from "@ianbicking/canvas-loop";
import { cardTop, pullAt, trayIndex } from "./file-room-drawer-tea.js";
import { type Plan, clamp01, lerp, reachLift, smooth, stopAt } from "./file-room-layout-tea.js";
import type { BeeState } from "./file-room-path-tea.js";

export interface CardDraw {
  /** "hand": drawn at the near hand; "free": at (x, y). */
  mode: "hand" | "free";
  x: number;
  y: number;
  /** Horizontal scale: a card seen edge-on in the row is thin, face-on in the hand it is full width. */
  sx: number;
  rot: number;
}

export interface Act {
  /** Feet above the ground. */
  lift: number;
  /** Body lowered in a crouch, in pixels. */
  crouch: number;
  /** True: the lift is made on accordion stilts; false: on a flutter-hop. */
  stilts: boolean;
  open: number;
  /** Missing card in the open row, or -1. */
  gap: number;
  /** World points the near and far hands go to; null leaves the arm to swing. */
  near: Vec2 | null;
  far: Vec2 | null;
  card: CardDraw | null;
  /** An exclamation mark above the head, at this point. */
  mark: Vec2 | null;
}

const NONE: Act = { lift: 0, crouch: 0, stilts: false, open: 0, gap: -1, near: null, far: null, card: null, mark: null };

type Key = readonly [number, Vec2];
/** A point that moves smoothly through keyframes (time, point) and holds at both ends. */
function track(t: number, keys: readonly Key[]): Vec2 {
  const first = keys[0];
  if (first === undefined) return [0, 0];
  if (t <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (a === undefined || b === undefined) break;
    if (t <= b[0]) {
      const k = smooth((t - a[0]) / (b[0] - a[0]));
      return [lerp(a[1][0], b[1][0])(k), lerp(a[1][1], b[1][1])(k)];
    }
  }
  return keys[keys.length - 1]?.[1] ?? first[1];
}
const plus = (p: Vec2, delta: Vec2): Vec2 => [p[0] + delta[0], p[1] + delta[1]];
const scalarTrack = (t: number, keys: readonly (readonly [number, number])[]): number => track(t, keys.map(([k, v]): Key => [k, [v, 0]]))[0];

/** Where points sit relative to the clerk (feet at x, by), facing dir. */
interface Frame {
  x: number;
  by: number;
  dir: 1 | -1;
}
const rest = (f: Frame): Vec2 => [f.x + f.dir * 7, f.by - 24];
const chest = (f: Frame): Vec2 => [f.x + f.dir * 20, f.by - 36];
const reading = (f: Frame): Vec2 => [f.x + f.dir * 22, f.by - 54];
/** The card hangs a little in front of and below the hand that holds it. */
export const holdOffset = (dir: 1 | -1): Vec2 => [dir * 4, 5];
const handFor = (card: Vec2, dir: 1 | -1): Vec2 => plus(card, [-holdOffset(dir)[0], -holdOffset(dir)[1]]);

/** The extension of stilts or the hop: 0 on the ground, 1 at full height. */
const extension = (d: number): number => smooth(d / 28) * (1 - smooth((d - 152) / 28));
const openAt = (d: number): number => smooth((d - 30) / 30) * (1 - smooth((d - 130) / 30));

function drop(state: BeeState, f: Frame): Act {
  const s = state.stall;
  const floor: Vec2 = [f.x + f.dir * 16, state.y - 3];
  const up = chest(f);
  const card = track(s, [[0, up], [0.18, floor], [0.62, floor], [0.85, up]]);
  const held = s < 0.1 || s > 0.62;
  const near = track(s, [[0, handFor(up, f.dir)], [0.1, handFor(up, f.dir)], [0.4, plus(floor, [0, -4])], [0.62, plus(floor, [0, -4])], [0.85, handFor(up, f.dir)]]);
  return {
    ...NONE,
    crouch: 8 * (smooth((s - 0.3) / 0.15) - smooth((s - 0.7) / 0.15)),
    near,
    far: rest(f),
    card: { mode: held ? "hand" : "free", x: card[0], y: card[1], sx: 1, rot: held ? 0 : 1.3 * clamp01((s - 0.1) / 0.1) },
    mark: s > 0.12 && s < 0.5 ? [f.x, state.y - 88] : null,
  };
}

function atStop(state: BeeState, plan: Plan): Act {
  const stop = stopAt(state.stop);
  const d = state.d;
  const ext = extension(d);
  const bounce = plan.egg === "surprise" && state.stop === 4 && d > 104 && d < 132 ? 9 * Math.sin((Math.PI * (d - 104)) / 28) : 0;
  const lift = reachLift(stop) * ext + bounce;
  const f: Frame = { x: state.x, by: state.y - lift, dir: state.dir };
  const open = openAt(d);
  const j = trayIndex(stop);
  const pull = pullAt(stop, open);
  const top = cardTop(stop, j);
  const slot = plus(top, [0, 2]);
  const rise = plus(top, [0, -12]);
  const far = track(d, [[0, rest(f)], [18, rest(f)], [30, pull], [58, pull], [70, rest(f)], [118, rest(f)], [128, pull], [158, pull], [172, rest(f)]]);
  const marker: Vec2 = [f.x, f.by - 90];
  const base = { ...NONE, lift, stilts: plan.stilts, open, far, mark: bounce > 0 && d > 108 ? marker : null };
  if (stop.act === "take") {
    const card = track(d, [[66, slot], [84, rise], [104, reading(f)], [132, reading(f)], [146, chest(f)]]);
    const sx = scalarTrack(d, [[66, 0.2], [84, 0.2], [102, 1]]);
    const near = d < 66 ? track(d, [[0, rest(f)], [46, rest(f)], [66, handFor(slot, f.dir)]]) : handFor(card, f.dir);
    return { ...base, gap: d >= 66 ? j : -1, near, card: d < 66 ? null : { mode: "hand", x: card[0], y: card[1], sx, rot: 0 } };
  }
  const above = plus(top, [0, -16]);
  const card = track(d, [[0, chest(f)], [8, chest(f)], [26, reading(f)], [56, reading(f)], [74, above], [96, above], [116, slot]]);
  const sx = scalarTrack(d, [[0, 1], [96, 1], [116, 0.2]]);
  const placed = d >= 118;
  const near = placed ? track(d, [[118, handFor(slot, f.dir)], [142, rest(f)]]) : handFor(card, f.dir);
  return { ...base, gap: placed ? -1 : j, near, card: placed ? null : { mode: "hand", x: card[0], y: card[1], sx, rot: 0 } };
}

/** The clerk's act at this moment. */
export function actAt(state: BeeState, plan: Plan): Act {
  if (!state.visible) return NONE;
  const f: Frame = { x: state.x, by: state.y, dir: state.dir };
  if (state.stop >= 0) return atStop(state, plan);
  if (state.stall >= 0) return drop(state, f);
  if (state.kind === "walk" && state.carrying) {
    const c = chest(f);
    return { ...NONE, near: handFor(c, f.dir), far: plus(c, [-f.dir * 8, 5]), card: { mode: "hand", x: c[0], y: c[1], sx: 1, rot: 0 } };
  }
  if (state.kind === "climb" && state.carrying) {
    return { ...NONE, card: { mode: "free", x: f.x + f.dir * 3, y: f.by - 30, sx: 1, rot: Math.PI / 2 } };
  }
  return NONE;
}


