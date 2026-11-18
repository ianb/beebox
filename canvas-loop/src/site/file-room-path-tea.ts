// The clerk's schedule as a pure function of the frame: a list of segments
// (walking, climbing a ladder, standing at a drawer) built from the route in
// the layout file, and the lamp levels that follow from it.
import { LADDER_X, MIDDLE, STOPS, TAU, clamp01, lerp, smooth, standX, standY, stopAt } from "./file-room-layout-tea.js";

export { TAU };
/** Frames in one loop. The room is dark and empty again at the end. */
export const LOOP = 4000;
const START = 60;
const DWELL = 180;
const WALK = 4.2;
const RUN = 11;
const CLIMB = 3.6;
const ENTRY_X = -130;
/** Frames a turn-around takes. */
const TURN = 12;

type Kind = "walk" | "climb" | "stay";
interface Seg {
  kind: Kind;
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dir: 1 | -1;
  /** The stop while standing at one, else -1. */
  stop: number;
  carrying: boolean;
  /** Distance walked or climbed before this segment. */
  base: number;
  /** True for the stretch where the "drop" variation stalls the clerk. */
  dropZone: boolean;
}

const sign = (n: number): 1 | -1 => (n < 0 ? -1 : 1);

/** Pieces of a walk from x0 to x1, split where it enters or leaves the hidden middle. */
function pieces(x0: number, x1: number): readonly [number, number][] {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const cuts = [MIDDLE.from, MIDDLE.to].filter((c) => c > lo && c < hi);
  const xs = [x0, ...(x1 > x0 ? cuts : cuts.toReversed()), x1];
  return xs.slice(1).map((x, i): [number, number] => [xs[i] ?? x0, x]);
}

function buildSegs(): { segs: Seg[]; end: number } {
  const segs: Seg[] = [];
  let t = START;
  let base = 0;
  let px = ENTRY_X;
  let py = standY(stopAt(0));
  let dir: 1 | -1 = 1;
  let carrying = false;
  let dropDone = false;
  const add = (seg: Omit<Seg, "t0" | "t1" | "base" | "dropZone"> & { speed: number; dropZone?: boolean }): void => {
    const dist = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
    const frames = seg.kind === "stay" ? DWELL : Math.max(dist === 0 ? 30 : 12, Math.round(dist / seg.speed));
    segs.push({ ...seg, t0: t, t1: t + frames, base, dropZone: seg.dropZone ?? false });
    t += frames;
    base += dist;
    px = seg.x1;
    py = seg.y1;
    if (seg.kind !== "stay") dir = seg.dir;
  };
  const walk = (x1: number, drop: boolean): void => {
    for (const [a, b] of pieces(px, x1)) {
      const mid = a >= MIDDLE.from && a <= MIDDLE.to && b >= MIDDLE.from && b <= MIDDLE.to;
      const zone = drop && !dropDone && !mid && Math.abs(b - a) > 150;
      if (zone) dropDone = true;
      add({ kind: "walk", x0: a, y0: py, x1: b, y1: py, dir: b === a ? dir : sign(b - a), stop: -1, carrying, speed: mid ? RUN : WALK, dropZone: zone });
    }
    if (px !== x1) add({ kind: "walk", x0: px, y0: py, x1, y1: py, dir, stop: -1, carrying, speed: WALK });
  };
  for (const [i, s] of STOPS.entries()) {
    const x = standX(s);
    const y = standY(s);
    carrying = i > 0 && stopAt(i - 1).act === "take";
    if (i === 0) {
      add({ kind: "walk", x0: ENTRY_X, y0: y, x1: x, y1: y, dir: 1, stop: -1, carrying, speed: WALK });
    } else if (y !== py) {
      const ladder = px < 800 ? LADDER_X.left : LADDER_X.right;
      walk(ladder, false);
      add({ kind: "climb", x0: ladder, y0: py, x1: ladder, y1: y, dir, stop: -1, carrying, speed: CLIMB });
      walk(x, false);
    } else {
      walk(x, i === 1);
    }
    add({ kind: "stay", x0: x, y0: y, x1: x, y1: y, dir: s.side === -1 ? 1 : -1, stop: i, carrying: false, speed: 1 });
  }
  carrying = false;
  add({ kind: "walk", x0: px, y0: py, x1: px < 800 ? ENTRY_X : 1730, y1: py, dir: px < 800 ? -1 : 1, stop: -1, carrying, speed: WALK });
  return { segs, end: t };
}
const BUILT = buildSegs();
const SEGS: readonly Seg[] = BUILT.segs;
/** The frame the clerk has left; every lamp is off 280 frames later. */
export const SCHEDULE_END = BUILT.end;

export interface BeeState {
  x: number;
  /** The baseline the feet stand on. */
  y: number;
  dir: 1 | -1;
  /** -1..1 horizontal facing, eased through 0 as they turn round. */
  turn: number;
  kind: Kind | "away";
  /** Distance walked (walking) or climbed (climbing) so far, for the limb cycles. */
  walked: number;
  /** The stop they are at, or -1. */
  stop: number;
  /** Frames since arriving at the stop, or -1. */
  d: number;
  carrying: boolean;
  /** 0..1 progress of the "drop" stall while it lasts, else -1. */
  stall: number;
  visible: boolean;
}

const FIRST: Seg = { kind: "walk", t0: 0, t1: 1, x0: 0, y0: 0, x1: 0, y1: 0, dir: 1, stop: -1, carrying: false, base: 0, dropZone: false };
const segAt = (i: number): Seg => SEGS[i] ?? FIRST;

/** The "drop" variation stalls a walk part-way: 0..0.3 walking, 0.3..0.7 standing, then hurrying on. */
const warp = (u: number): number => (u < 0.3 ? u : u < 0.7 ? 0.3 : lerp(0.3, 1)((u - 0.7) / 0.3));

export function beeAt(frame: number, drop: boolean): BeeState {
  const first = segAt(0);
  const away: BeeState = { x: first.x0, y: first.y0, dir: 1, turn: 1, kind: "away", walked: 0, stop: -1, d: -1, carrying: false, stall: -1, visible: false };
  const i = SEGS.findIndex((s) => frame >= s.t0 && frame < s.t1);
  if (frame < START || i === -1) return frame < START ? away : { ...away, x: segAt(SEGS.length - 1).x1, y: segAt(SEGS.length - 1).y1 };
  const s = segAt(i);
  const prev = i > 0 ? segAt(i - 1).dir : 1;
  const turn = lerp(prev, s.dir)(smooth((frame - s.t0) / TURN));
  const u = clamp01((frame - s.t0) / (s.t1 - s.t0));
  const stalling = drop && s.dropZone;
  const w = stalling ? warp(u) : u;
  const ease = s.kind === "walk" && !stalling ? 0.5 * w + 0.5 * smooth(w) : w;
  const dist = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
  return {
    x: lerp(s.x0, s.x1)(ease),
    y: lerp(s.y0, s.y1)(ease),
    dir: s.dir,
    turn,
    kind: s.kind,
    walked: s.base + dist * ease,
    stop: s.stop,
    d: s.kind === "stay" ? frame - s.t0 : -1,
    carrying: s.carrying,
    stall: stalling && u >= 0.3 && u < 0.7 ? (u - 0.3) / 0.4 : -1,
    visible: true,
  };
}

/** 0..1: how lit a cabinet's lamp is. Warms over 100 frames as the clerk comes near, fades over 240 after they leave. */
export function lampLevel(cab: number, frame: number): number {
  let level = 0;
  for (const s of SEGS) {
    if (s.kind !== "stay" || stopAt(s.stop).cab !== cab) continue;
    const x = frame - (s.t0 - 90);
    level = Math.max(level, Math.min(smooth(x / 100), 1 - smooth((x - (s.t1 + 20 - (s.t0 - 90))) / 240)));
  }
  return level;
}

/** Frame at which the clerk arrives at a stop. */
export const arrivalOf = (stop: number): number => SEGS.find((s) => s.kind === "stay" && s.stop === stop)?.t0 ?? 0;
export const phaseOf = (walked: number, stride: number): number => (walked / stride) % 1;
export const DWELL_FRAMES = DWELL;
export const TAU2 = TAU;
