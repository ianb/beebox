// Fixed layout of the file-room sketch: a tall dark archive of five levels, a
// pair of cabinets on every level (one in each side third), the route the
// clerk walks, and which variation of that route a given cycle gets.
// Art is drawn at the size of the first version and placed at scale K.
export const TAU = Math.PI * 2;

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

// ---- the canvas and its levels -----------------------------------------------------

export const WIDTH = 1600;
/** Canvas height. The route below is built for five levels, which fit in 2400. */
export const HEIGHT = 2400;
/** Scale of everything drawn, relative to the first version. */
export const K = 0.65;
const LEVEL_TOP = 400;
export const LEVEL_GAP = 470;
/** The part of the canvas that belongs to a level: from above its lamps to just below its platform. */
export const bandTop = (level: number): number => (level === 0 ? 0 : LEVEL_TOP + level * LEVEL_GAP - 380);
export const bandBottom = (level: number): number => (level >= Math.floor((HEIGHT - 520) / LEVEL_GAP) ? HEIGHT : LEVEL_TOP + level * LEVEL_GAP + 90);
export const LEVELS = Math.floor((HEIGHT - 520) / LEVEL_GAP) + 1;
/** Top of the platform each level's cabinets stand on. */
export const levelFloor = (level: number): number => LEVEL_TOP + level * LEVEL_GAP;
/** The clerk's feet stand this far below the cabinets' base, on the platform's front edge. */
export const GROUND_OFF = 13;
/**
 * Everything that matters (cabinets, lamps, the clerk at work, ladders) stays within
 * the outer 240 pixels of the canvas, which stay visible in the narrowest window; the
 * page card covers the middle, which the clerk crosses at a run.
 */
export const BAND = 240;
export const LADDER_X = { left: 216, right: 1384 } as const;
export const MIDDLE = { from: BAND, to: WIDTH - BAND } as const;

// ---- cabinets --------------------------------------------------------------------------

export interface Cabinet {
  x: number;
  level: number;
  lamp: "banker" | "pendant";
  /** 0..3: wood or steel, two looks each; cabinets of one variant share their cached pictures. */
  variant: number;
}
// Left cabinets the clerk stands left of (-1) sit at x 134..140; those they stand right of (+1) at 110..118, so a ladder fits at the band's inner edge.
const LEFT_X = [140, 110, 134, 118, 138] as const;
const RIGHT_X = [1480, 1470, 1476, 1466, 1480] as const;
/** Cabinet 2k is the left one on level k, 2k + 1 the right one. */
export const CABS: readonly Cabinet[] = Array.from({ length: LEVELS * 2 }, (_, i): Cabinet => {
  const level = Math.floor(i / 2);
  const left = i % 2 === 0;
  const lamp = (level + i) % 2 === 0 ? "banker" : "pendant";
  return { x: (left ? LEFT_X[level] : RIGHT_X[level]) ?? 140, level, lamp, variant: (lamp === "pendant" ? 2 : 0) + (level % 2) };
});
const FIRST_CAB: Cabinet = { x: 140, level: 0, lamp: "banker", variant: 0 };
export const cabAt = (i: number): Cabinet => CABS[i] ?? FIRST_CAB;
export const cabBase = (i: number): number => levelFloor(cabAt(i).level);
export const ROWS = 4;
/** Height of a cabinet and the drawer pitch, in canvas pixels. */
export const CAB_H = 332 * K;
export const PITCH = 78 * K;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const slotOf = (cab: number, row: number): Slot => ({ x: cabAt(cab).x - 75 * K, y: cabBase(cab) - CAB_H + 8 * K + row * PITCH, w: 150 * K, h: 72 * K });

/** The shade's rim: where a lamp is drawn, and its light sits just below it. */
export const lampRim = (cab: number): { x: number; y: number } => ({ x: cabAt(cab).x, y: cabBase(cab) - CAB_H - (cabAt(cab).lamp === "pendant" ? 100 * K : 66 * K) });
export const lampLightAt = (cab: number): readonly [number, number] => [lampRim(cab).x, lampRim(cab).y + 14 * K];

// ---- the route -----------------------------------------------------------------------------

export interface Stop {
  cab: number;
  /** Row 3 is at the clerk's hand height on the ground; row 1 is a high drawer. */
  row: number;
  act: "take" | "file";
  /** Which side of the cabinet the clerk stands on: -1 left, 1 right. */
  side: -1 | 1;
}
/** Down the archive: right ladder after level 0, left after 1, right after 2, left after 3. Rows 1 are high drawers. */
export const STOPS: readonly Stop[] = [
  { cab: 0, row: 3, act: "take", side: -1 },
  { cab: 1, row: 3, act: "file", side: -1 },
  { cab: 1, row: 1, act: "take", side: -1 },
  { cab: 3, row: 1, act: "file", side: 1 },
  { cab: 2, row: 3, act: "take", side: 1 },
  { cab: 4, row: 3, act: "file", side: -1 },
  { cab: 5, row: 1, act: "take", side: -1 },
  { cab: 7, row: 3, act: "file", side: 1 },
  { cab: 6, row: 1, act: "take", side: 1 },
  { cab: 8, row: 3, act: "file", side: -1 },
];
const FIRST_STOP: Stop = { cab: 0, row: 3, act: "take", side: -1 };
export const stopAt = (i: number): Stop => STOPS[i] ?? FIRST_STOP;
/** How far from the cabinet's centre the clerk stands: at its edge, an arm's reach from the pull. */
export const STAND = 52;
/** Scale of the clerk: about 84 px from feet to antenna tips. */
export const S = 0.62;
export const standX = (stop: Stop): number => cabAt(stop.cab).x + stop.side * STAND;
export const standY = (stop: Stop): number => cabBase(stop.cab) + GROUND_OFF;
/** How high the clerk must rise to reach the pull of a stop's drawer. */
export const reachLift = (stop: Stop): number => (3 - stop.row) * PITCH;

// ---- variations --------------------------------------------------------------------------------

export const VARIATIONS = ["auto", "plain", "stilts", "hop", "moth", "drop", "surprise"] as const;
export type Variation = (typeof VARIATIONS)[number];
export type Egg = "none" | "moth" | "drop" | "surprise";

export interface Plan {
  /** True: high drawers are reached on accordion stilts; false: by a short wing-flutter hop. */
  stilts: boolean;
  egg: Egg;
}

/** What a cycle does. `auto` chooses from the cycle number; the others force one variation. */
export function planFor(cycle: number, variation: Variation): Plan {
  switch (variation) {
    case "plain":
    case "hop":
      return { stilts: false, egg: "none" };
    case "stilts":
      return { stilts: true, egg: "none" };
    case "moth":
    case "drop":
    case "surprise":
      return { stilts: false, egg: variation };
    case "auto": {
      const r = hash(cycle * 5.3 + 5.1);
      const egg: Egg = r < 0.6 ? "none" : r < 0.73 ? "moth" : r < 0.86 ? "drop" : "surprise";
      return { stilts: hash(cycle * 3.7 + 1.3) < 0.35, egg };
    }
  }
}
