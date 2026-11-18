// Fixed layout and timing of the file-room sketch: where the cabinets, lamps
// and drawers are, and every motion as a pure function of the frame.
import type { Vec2 } from "@ianbicking/canvas-loop";

export const TAU = Math.PI * 2;

// ---- timing -----------------------------------------------------------------

/** Frames per stop segment: a flight, then a dwell at a drawer. */
export const SEG = 330;
export const TRAVEL = 120;
/** The bee flies away during the segment after the last stop; every lamp is dark again by LOOP. */
export const LOOP = 3600;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** `lerp(a, b)(t)` runs from a (t = 0) to b (t = 1). */
export const lerp =
  (a: number, b: number) =>
  (t: number): number =>
    a + (b - a) * t;
/** A cheap deterministic hash in 0..1, for decoration fixed at build time. */
export const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---- room layout ------------------------------------------------------------

export const FLOOR = 760;
export const CAB_W = 200;
export const DRAWER_PITCH = 94;
export const TALL = [true, false, true, true, false, true, false, true] as const;
export const STEEL = [false, true, false, false, true, false, true, false] as const;

export const cabRows = (c: number): number => (TALL[c] === true ? 5 : 3);
export const cabTop = (c: number): number => FLOOR - 14 - 8 - cabRows(c) * DRAWER_PITCH;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const slotOf = (c: number, row: number): Slot => ({ x: c * CAB_W + 12, y: cabTop(c) + 8 + row * DRAWER_PITCH, w: CAB_W - 24, h: 88 });

export interface Lamp {
  kind: "pendant" | "banker";
  x: number;
}
export const LAMPS: readonly Lamp[] = [
  { kind: "pendant", x: 100 },
  { kind: "banker", x: 300 },
  { kind: "pendant", x: 500 },
  { kind: "banker", x: 900 },
  { kind: "pendant", x: 1100 },
  { kind: "banker", x: 1300 },
  { kind: "pendant", x: 1500 },
];

/** Where each lamp's light sits. */
export const lampLightAt = (l: Lamp): Vec2 => (l.kind === "pendant" ? [l.x, 176] : [l.x, 404]);

export interface Stop {
  cab: number;
  row: number;
  /** The lamp that warms up for this stop. */
  lamp: number;
}
/** The drawers the bee visits, in order: right along the wall, then back left. */
export const STOPS: readonly Stop[] = [
  { cab: 0, row: 3, lamp: 0 },
  { cab: 1, row: 1, lamp: 1 },
  { cab: 2, row: 2, lamp: 2 },
  { cab: 4, row: 1, lamp: 3 },
  { cab: 5, row: 3, lamp: 4 },
  { cab: 6, row: 0, lamp: 5 },
  { cab: 7, row: 2, lamp: 6 },
  { cab: 6, row: 2, lamp: 5 },
  { cab: 4, row: 2, lamp: 3 },
  { cab: 2, row: 0, lamp: 2 },
];
const FIRST_STOP: Stop = { cab: 0, row: 3, lamp: 0 };
export const stopAt = (i: number): Stop => STOPS[i] ?? FIRST_STOP;

const OFFSCREEN: Vec2 = [-110, 330];

/** The point the bee hovers at for a stop: above the drawer's face. */
function hoverOf(stop: Stop): Vec2 {
  const s = slotOf(stop.cab, stop.row);
  return [s.x + s.w / 2, s.y - 30];
}

// ---- drawer, card, lamp levels ---------------------------------------------

/** Frame within a stop's dwell (0 at arrival), or -1 when the bee is flying. */
export const dwellOf = (t: number): number => (t < TRAVEL ? -1 : t - TRAVEL);

/** How far the stop's drawer is open: 0 closed, 1 fully out. */
export function openAmount(d: number): number {
  if (d < 0) return 0;
  if (d < 45) return smooth((d - 5) / 40);
  return 1 - smooth((d - 160) / 35);
}

/** How far the card has risen from the drawer to the bee: 0 in the drawer, 1 held. */
export function liftAmount(d: number): number {
  if (d < 45) return 0;
  if (d < 125) return smooth((d - 45) / 45);
  return 1 - smooth((d - 125) / 35);
}

/** 0..1: how lit a lamp is. Warms over 90 frames once the bee is near, fades over 240 after it leaves. */
export function lampLevel(lamp: number, frame: number): number {
  let level = 0;
  for (const [s, stop] of STOPS.entries()) {
    if (stop.lamp !== lamp) continue;
    const x = frame - (s * SEG + 80);
    level = Math.max(level, Math.min(smooth(x / 90), 1 - smooth((x - (SEG - 50)) / 240)));
  }
  return level;
}

// ---- the bee's path ---------------------------------------------------------

export interface BeeState {
  x: number;
  y: number;
  /** -1 facing left, 1 facing right, eased through 0 as it turns. */
  turn: number;
  /** The stop being visited (or just left) and the frame within its segment. */
  stop: number;
  t: number;
}

const directionOf = (from: Vec2, to: Vec2): number => Math.sign(to[0] - from[0]) || 1;

/** Where the bee hovers before stop `s` (the last segment, `STOPS.length`, is the way out). */
const waypoint = (s: number): Vec2 => (s < 0 || s >= STOPS.length ? OFFSCREEN : hoverOf(stopAt(s)));

export function beeAt(frame: number): BeeState {
  const s = Math.min(STOPS.length, Math.floor(frame / SEG));
  const t = frame - s * SEG;
  const from = waypoint(s - 1);
  const to = waypoint(s);
  const prevDir = s === 0 ? 1 : directionOf(waypoint(s - 2), from);
  const turn = lerp(prevDir, directionOf(from, to))(smooth(t / 24));
  const u = clamp01(t / TRAVEL);
  const edge = Math.sin(Math.PI * u);
  const bob = 5 * Math.sin((TAU * 60 * frame) / LOOP);
  const sway = 3 * Math.sin((TAU * 83 * frame) / LOOP + 1.3);
  const x = lerp(from[0], to[0])(smooth(u)) + 18 * Math.sin(TAU * 1.5 * u) * edge + sway;
  const y = lerp(from[1], to[1])(smooth(u)) - 34 * edge + 15 * Math.sin(TAU * 2.5 * u + 0.6) * edge + bob;
  return { x, y, turn, stop: s, t };
}
