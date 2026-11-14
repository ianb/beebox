// The sample map, shared with the LPC baseline render (scratch/game-tiles/scene.ts).
// Ground: one char per cell. Objects: a second grid, '.' for none.
//
// Ground:  . grass   , grass with flowers   " tall grass   = path   ~ water
//          # forest   s tilled soil
// Objects: T tree  O oak  A autumn tree  P pine  y young tree  f fence  W well
//          H haystack  b bush  r rock  m mushrooms  l lily  L lily flower  R reeds
//          c cabbages  k carrots  w wheat  B barrel

export const GROUND = [
  "########################",
  "########################",
  "##....,.....==....######",
  "#...\"\"\".....==.....,..##",
  "#..\"\"\"\"\"....==.........#",
  "#..\"\"\"\".....==....~~~..#",
  "#...\"\"...,...=====~~~~~#",
  "#.........,.....=.~~~~~#",
  "#=====........,.=..~~~.#",
  "#....=..........=......#",
  "#....=..ssssss..=..\"\"\".#",
  "#....=..ssssss..=.\"\"\"\".#",
  "#.,..=..ssssss..=..\"\"..#",
  "#....===========......,#",
  "##......,......=.....###",
  "########################",
];

export const OBJECTS = [
  "........................",
  "........................",
  "........................",
  "..T......P.....O....y...",
  ".................A......",
  ".................R......",
  "........................",
  ".......W...........lL...",
  ".................R..L...",
  "..H.....ffffffff........",
  "...B....cccwww..........",
  "..y.....kkkwww........r.",
  "........ccckkk........b.",
  ".....................m..",
  "..r.....b...............",
  "........................",
];

export const W = 24;
export const H = 16;
/** Pixels per cell, as game-world's tiles. */
export const S = 32;

export type Ground = "grass" | "flowers" | "tall" | "path" | "water" | "forest" | "soil";

const GROUND_OF: Record<string, Ground> = {
  ".": "grass", ",": "flowers", '"': "tall", "=": "path", "~": "water", "#": "forest", s: "soil",
};

/** The ground at a cell. Off the map the forest continues; everything else is grass. */
export function groundAt(x: number, y: number): Ground {
  if (x < 0 || y < 0 || x >= W || y >= H) return "forest";
  return GROUND_OF[GROUND[y]?.[x] ?? "#"] ?? "grass";
}

export function objectAt(x: number, y: number): string {
  return OBJECTS[y]?.[x] ?? ".";
}

/** A stable number in [0, 1) for a cell and a salt: every mark's "randomness". */
export function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The animation loop length in frames. Every motion repeats exactly over it, so a
 * run of PERIOD frames can be frozen into a looping strip. */
export const PERIOD = 96;

/** Wind at a world point (px) and frame: about -1..1, a slow swell with a gust
 * travelling west to east. Whole cycles per PERIOD, so it loops. */
export function wind(x: number, y: number, t: number): number {
  const a = (2 * Math.PI * t) / PERIOD;
  return 0.55 * Math.sin(a - x * 0.012 + y * 0.004) + 0.35 * Math.sin(2 * a - x * 0.03 - y * 0.01 + 1.3);
}
