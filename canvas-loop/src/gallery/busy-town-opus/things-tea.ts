// What can be clicked, where it is, how long its act lasts, and who it sets off.
// Positions are pure functions of the model, so update (hit-testing) and draw
// (painting) agree without sharing state.

export const IDS = [
  "baker",
  "chimney",
  "window",
  "cat",
  "mail",
  "mailbox",
  "painter",
  "bucket",
  "owl",
  "hydrant",
  "dog",
  "lamp",
  "grocer",
  "clock",
  "pigeons",
  "flag",
  "duck",
  "bus",
  "manhole",
  "snail",
] as const;
export type Id = (typeof IDS)[number];

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Clock {
  readonly frame: number;
  readonly start: Readonly<Record<Id, number>>;
}

/** Frames each act runs (60 fps). */
export const DUR: Readonly<Record<Id, number>> = {
  baker: 170,
  chimney: 150,
  window: 220,
  cat: 110,
  mail: 120,
  mailbox: 130,
  painter: 150,
  bucket: 120,
  owl: 140,
  hydrant: 170,
  dog: 140,
  lamp: 200,
  grocer: 160,
  clock: 160,
  pigeons: 170,
  flag: 140,
  duck: 120,
  bus: 230,
  manhole: 170,
  snail: 160,
};

/** Who reacts when an act starts, and how many frames later. */
export const CHAIN: Readonly<Partial<Record<Id, readonly { readonly id: Id; readonly delay: number }[]>>> = {
  baker: [{ id: "dog", delay: 45 }],
  window: [{ id: "cat", delay: 95 }],
  clock: [
    { id: "pigeons", delay: 20 },
    { id: "owl", delay: 40 },
  ],
  painter: [{ id: "bucket", delay: 70 }],
  hydrant: [{ id: "dog", delay: 40 }],
  mail: [{ id: "mailbox", delay: 40 }],
  bus: [{ id: "duck", delay: 205 }],
  manhole: [{ id: "snail", delay: 25 }],
  flag: [{ id: "pigeons", delay: 15 }],
};

/** Every act's start frame before anything has been clicked: long ago. */
export const NOT_STARTED: Readonly<Record<Id, number>> = {
  baker: -100_000,
  chimney: -100_000,
  window: -100_000,
  cat: -100_000,
  mail: -100_000,
  mailbox: -100_000,
  painter: -100_000,
  bucket: -100_000,
  owl: -100_000,
  hydrant: -100_000,
  dog: -100_000,
  lamp: -100_000,
  grocer: -100_000,
  clock: -100_000,
  pigeons: -100_000,
  flag: -100_000,
  duck: -100_000,
  bus: -100_000,
  manhole: -100_000,
  snail: -100_000,
};

// ── Layout ───────────────────────────────────────────────────────────
export const W = 1000;
export const H = 750;
export const STREET = 540; // building bases / back of the sidewalk
export const CURB = 600;
export const ROAD_END = 712;
export const FEET = 566; // where standing folk put their feet

export const BUS_HOME = 590;
export const BUS_Y = 582;
export const BUS_W = 220;
export const BUS_H = 112;

/** Act progress 0..1 while an act runs, otherwise null. */
export function act(c: Clock, id: Id): number | null {
  const t = (c.frame - c.start[id]) / DUR[id];
  return t >= 0 && t < 1 ? t : null;
}

/** Bus left edge: drives off right, wraps round the block, and creeps back to the stop. */
export function busX(c: Clock): number {
  const t = act(c, "bus");
  if (t === null) return BUS_HOME;
  if (t < 0.45) {
    const k = t / 0.45;
    return BUS_HOME + k * k * (W - BUS_HOME + 40);
  }
  if (t < 0.55) return W + 100; // round the corner, out of sight
  const k = (t - 0.55) / 0.45;
  const ease = 1 - (1 - k) * (1 - k);
  return -BUS_W - 60 + ease * (BUS_HOME + BUS_W + 60);
}

/** Snail left edge: it crawls the curb and loops once every ~80 s. */
export function snailX(frame: number): number {
  return 40 + ((frame * 0.05) % 300);
}

const STATIC: Readonly<Record<Exclude<Id, "bus" | "snail">, Box>> = {
  baker: { x: 84, y: 470, w: 60, h: 98 },
  chimney: { x: 168, y: 196, w: 34, h: 56 },
  window: { x: 50, y: 282, w: 80, h: 86 },
  cat: { x: 52, y: 362, w: 50, h: 54 },
  mail: { x: 268, y: 470, w: 60, h: 98 },
  mailbox: { x: 360, y: 506, w: 40, h: 64 },
  painter: { x: 520, y: 330, w: 70, h: 230 },
  bucket: { x: 586, y: 548, w: 30, h: 32 },
  owl: { x: 440, y: 236, w: 56, h: 62 },
  hydrant: { x: 420, y: 530, w: 28, h: 44 },
  dog: { x: 452, y: 534, w: 74, h: 52 },
  lamp: { x: 594, y: 384, w: 30, h: 190 },
  grocer: { x: 740, y: 470, w: 60, h: 98 },
  clock: { x: 868, y: 168, w: 64, h: 64 },
  pigeons: { x: 808, y: 306, w: 186, h: 30 },
  flag: { x: 896, y: 44, w: 70, h: 50 },
  duck: { x: 900, y: 478, w: 60, h: 90 },
  manhole: { x: 268, y: 640, w: 70, h: 40 },
};

export function boxOf(c: Clock, id: Id): Box {
  if (id === "bus") return { x: busX(c), y: BUS_Y, w: BUS_W, h: BUS_H };
  if (id === "snail") return { x: snailX(c.frame), y: 578, w: 36, h: 26 };
  return STATIC[id];
}

/** Front-most first: the order a click is offered to things. */
const HIT_ORDER: readonly Id[] = [
  "bus",
  "snail",
  "manhole",
  "duck",
  "dog",
  "bucket",
  "hydrant",
  "mailbox",
  "baker",
  "mail",
  "grocer",
  "lamp",
  "cat",
  "painter",
  "owl",
  "window",
  "chimney",
  "pigeons",
  "clock",
  "flag",
];

export function hit(c: Clock, x: number, y: number): Id | null {
  for (const id of HIT_ORDER) {
    const b = boxOf(c, id);
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return id;
  }
  return null;
}
