// Fixed layout and timing of the file-room sketch: four cabinets standing
// apart in the dark, the schedule of the bee's visits, and every motion as a
// pure function of the frame.
export const TAU = Math.PI * 2;

/** Frames in one loop (60 s at 60 fps). The room is dark and empty again at the end. */
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

// ---- cabinets ------------------------------------------------------------------

/** The line where cabinets stand, and the line the bee's feet stand on (a little nearer the viewer). */
export const FLOOR = 780;
export const GROUND = 803;
export const CAB_W = 170;
export const ROWS = 4;
export const PITCH = 78;
export const cabTop = FLOOR - 12 - 8 - ROWS * PITCH;

export interface Cabinet {
  x: number;
  lamp: "banker" | "pendant";
}
/** Two on the left, two on the right; the page card covers the middle. */
export const CABS: readonly Cabinet[] = [
  { x: 210, lamp: "banker" },
  { x: 500, lamp: "pendant" },
  { x: 1100, lamp: "pendant" },
  { x: 1390, lamp: "banker" },
];
const FIRST_CAB: Cabinet = { x: 210, lamp: "banker" };
export const cabAt = (i: number): Cabinet => CABS[i] ?? FIRST_CAB;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const slotOf = (cab: number, row: number): Slot => ({ x: cabAt(cab).x - 75, y: cabTop + 8 + row * PITCH, w: 150, h: 72 });

/** Where a lamp's light sits, and the lamp's own anchor (shade rim). */
export const lampRim = (cab: number): { x: number; y: number } => ({ x: cabAt(cab).x, y: cabAt(cab).lamp === "pendant" ? 300 : cabTop - 7 - 58 });
export const lampLightAt = (cab: number): readonly [number, number] => [lampRim(cab).x, lampRim(cab).y + 12];

// ---- the bee's schedule ----------------------------------------------------------

export interface Stop {
  cab: number;
  /** Row 3 is at the bee's hand height on the ground; row 2 needs a hop. */
  row: number;
  act: "take" | "file";
  /** Which side of the cabinet the bee stands on: -1 left, 1 right. */
  side: -1 | 1;
}
export const STOPS: readonly Stop[] = [
  { cab: 0, row: 3, act: "take", side: -1 },
  { cab: 1, row: 3, act: "file", side: -1 },
  { cab: 1, row: 2, act: "take", side: -1 },
  { cab: 2, row: 3, act: "file", side: -1 },
  { cab: 2, row: 2, act: "take", side: -1 },
  { cab: 3, row: 3, act: "file", side: -1 },
  { cab: 3, row: 2, act: "take", side: -1 },
  { cab: 2, row: 3, act: "file", side: 1 },
];
const FIRST_STOP: Stop = { cab: 0, row: 3, act: "take", side: -1 };
export const stopAt = (i: number): Stop => STOPS[i] ?? FIRST_STOP;

const DWELL = 260;
const SPEED = 2.6;
const START = 90;
const ENTRY_X = -130;
const EXIT_X = 1730;
const HOP = 78;
/** How far from the cabinet's centre the bee stands: beside the cabinet's edge, an arm's reach from the pull. */
const STAND = 88;

export interface Visit {
  x: number;
  lift: number;
  dir: 1 | -1;
  arrive: number;
  depart: number;
  /** Distance walked when they arrive. */
  base: number;
}

const travelFrames = (dist: number): number => Math.max(50, Math.round(dist / SPEED));

function buildVisits(): { visits: Visit[]; exitEnd: number } {
  const visits: Visit[] = [];
  let t = START;
  let px = ENTRY_X;
  let walked = 0;
  for (const s of STOPS) {
    const x = cabAt(s.cab).x + s.side * STAND;
    const arrive = t + travelFrames(Math.abs(x - px));
    walked += Math.abs(x - px);
    visits.push({ x, lift: s.row === 3 ? 0 : HOP, dir: s.side === -1 ? 1 : -1, arrive, depart: arrive + DWELL, base: walked });
    t = arrive + DWELL;
    px = x;
  }
  return { visits, exitEnd: t + travelFrames(EXIT_X - px) };
}
const SCHEDULE = buildVisits();
export const VISITS: readonly Visit[] = SCHEDULE.visits;
const FIRST_VISIT: Visit = { x: 0, lift: 0, dir: 1, arrive: 0, depart: 0, base: 0 };
const visitAt = (i: number): Visit => VISITS[i] ?? FIRST_VISIT;

/** How far a stop's drawer is out: 0 closed, 1 fully out. */
export function openAmount(d: number): number {
  if (d < 30) return 0;
  if (d < 195) return smooth((d - 30) / 45) - smooth((d - 150) / 45);
  return 0;
}

/** 0..1 across the card's move between the drawer (0) and the bee's hands (1) at a take; reversed at a file. */
export function cardTravel(act: Stop["act"], d: number): number {
  const k = smooth((d - 75) / 50);
  return act === "take" ? k : 1 - k;
}

/** 0..1: how lit a cabinet's lamp is. Warms over 100 frames as the bee comes near, fades over 240 after they leave. */
export function lampLevel(cab: number, frame: number): number {
  let level = 0;
  for (const [i, s] of STOPS.entries()) {
    if (s.cab !== cab) continue;
    const v = visitAt(i);
    const x = frame - (v.arrive - 90);
    level = Math.max(level, Math.min(smooth(x / 100), 1 - smooth((x - (v.depart + 20 - (v.arrive - 90))) / 240)));
  }
  return level;
}

export interface BeeState {
  x: number;
  /** Height above the ground, for the hop to a higher drawer. */
  lift: number;
  dir: 1 | -1;
  /** Distance walked so far: drives the leg cycle. */
  walked: number;
  /** The stop they are at (-1 when walking or away). */
  stop: number;
  /** Frames since arriving at the stop (-1 when not at one). */
  d: number;
  /** True when they walk holding a card. */
  carrying: boolean;
  visible: boolean;
}

const sign = (n: number): 1 | -1 => (n < 0 ? -1 : 1);
const ease = (u: number): number => 0.5 * u + 0.5 * smooth(u);

export function beeAt(frame: number): BeeState {
  const away: BeeState = { x: ENTRY_X, lift: 0, dir: 1, walked: 0, stop: -1, d: -1, carrying: false, visible: false };
  if (frame < START) return away;
  let px = ENTRY_X;
  let pl = 0;
  let from = START;
  let pbase = 0;
  let pdir: 1 | -1 = 1;
  for (const [i, v] of VISITS.entries()) {
    const carrying = i > 0 && stopAt(i - 1).act === "take";
    if (frame < v.arrive) {
      const u = (frame - from) / (v.arrive - from);
      const dir = Math.abs(v.x - px) < 1 ? v.dir : sign(v.x - px);
      return { x: lerp(px, v.x)(ease(u)), lift: lerp(pl, v.lift)(smooth(u)), dir, walked: pbase + Math.abs(v.x - px) * ease(u), stop: -1, d: -1, carrying, visible: true };
    }
    if (frame < v.depart) return { x: v.x, lift: v.lift, dir: v.dir, walked: v.base, stop: i, d: frame - v.arrive, carrying: false, visible: true };
    px = v.x;
    pl = v.lift;
    from = v.depart;
    pbase = v.base;
    pdir = v.dir;
  }
  const u = clamp01((frame - from) / (SCHEDULE.exitEnd - from));
  const dir = Math.abs(EXIT_X - px) < 1 ? pdir : sign(EXIT_X - px);
  return { ...away, x: lerp(px, EXIT_X)(ease(u)), lift: lerp(pl, 0)(smooth(u * 3)), dir, walked: pbase + Math.abs(EXIT_X - px) * ease(u), visible: u < 1 };
}
