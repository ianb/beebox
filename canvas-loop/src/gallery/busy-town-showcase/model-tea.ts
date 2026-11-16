// The town's state, the light at a given hour, and what a click at a point hits.
import type { DeepReadonly, Voice } from "@ianbicking/canvas-loop";
import { clamp01, ramp } from "./ink-tea.js";
import { BACK_FEET, BASE, BOAT_Y, BUILDINGS, type Balloon, CART_FEET, CYCLIST_FEET, HALL, HOT_AIR, LAMPS, LAMP_H, MILL, MOUSE, RAIL_Y, TOWER, TRAM_H, TRAM_W, WALKERS, WINDOWS, type WalkerKind, boatX, cartX, cyclistX, duckHome, hotAirAt, tramX, walkerAt } from "./layout-tea.js";

export interface Rocket {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly hue: number;
}

export type Who = WalkerKind | "cyclist" | "cart";
export type Sky = "fair" | "rain" | "snow";

export interface Model {
  frame: number;
  /** Hours, 0..24. */
  clock: number;
  mouse: readonly [number, number] | null;
  /** Per window: the light was switched by hand (the opposite of what the hour says). */
  flipped: readonly boolean[];
  /** Per street lamp: switched by hand. */
  lampFlipped: readonly boolean[];
  /** The frame each happening started, or null. */
  bell: number | null;
  bakery: number | null;
  balloon: number | null;
  rowing: number | null;
  ducks: number | null;
  tram: number | null;
  petals: number | null;
  cafe: number | null;
  fish: number | null;
  hotAir: Balloon;
  /** Who reacted to a click, and when. */
  reactions: readonly { readonly who: Who; readonly at: number }[];
  /** The weather now, the weather before, and the frame it changed. */
  sky: { readonly kind: Sky; readonly prev: Sky; readonly at: number };
  thunder: number | null;
  millAngle: number;
  millSpin: number;
  rockets: readonly Rocket[];
  voices: readonly Voice[];
  count: number;
}

export const LASTS = { bell: 360, bakery: 540, balloonPop: 300, balloonBack: 420, rowing: 240, ducks: 300, tram: 50, petals: 320, cafe: 420, fish: 70, rocket: 150, reaction: 90, thunder: 120 } as const;
/** A rocket climbs for this many frames, then bursts. */
export const CLIMB = 42;

/** 0 by day, 1 at night. */
export function nightOf(h: number): number {
  if (h >= 7.5 && h <= 17.5) return 0;
  if (h > 17.5) return ramp(h, 17.5, 20.5);
  if (h < 5) return 1;
  return 1 - ramp(h, 5, 7.5);
}
/** The warm light of sunset and sunrise, 0..1. */
export function duskOf(h: number): number {
  const bump = (c: number, w: number): number => clamp01(1 - Math.abs(h - c) / w);
  return Math.max(bump(18.9, 1.8), bump(6.2, 1.4) * 0.8);
}

export function windowLit(model: DeepReadonly<Model>, i: number): boolean {
  const w = WINDOWS[i];
  if (!w) return false;
  return (nightOf(model.clock) > w.on) !== (model.flipped[i] ?? false);
}
export function lampLit(model: DeepReadonly<Model>, i: number): boolean {
  return (nightOf(model.clock) > 0.45) !== (model.lampFlipped[i] ?? false);
}

export type Target =
  | { kind: "window"; i: number }
  | { kind: "lamp"; i: number }
  | { kind: "folk"; who: Who }
  | { kind: "bell" | "hotair" | "bakery" | "tram" | "balloon" | "boat" | "ducks" | "mill" | "cafe" | "florist" | "fish" | "house" | "books" | "sky" };

export interface Hit {
  readonly target: Target;
  /** Where to draw the hover cue. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly hint: string;
}

const inRect = (x: number, y: number, rx: number, ry: number, rw: number, rh: number): boolean => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;

export function balloonHeld(model: DeepReadonly<Model>): boolean {
  return model.balloon === null;
}

function hitWater(model: DeepReadonly<Model>, x: number, y: number): Hit | null {
  const f = model.frame;
  const bx = boatX(f);
  if (inRect(x, y, bx - 64, BOAT_Y - 52, 128, 60)) return { target: { kind: "boat" }, x: bx, y: BOAT_Y - 18, r: 52, hint: "row, Fennick!" };
  for (let i = 0; i < 4; i++) {
    const [dx, dy] = duckHome(i, f);
    if (model.ducks === null && Math.hypot(x - dx, y - dy) < 18) return { target: { kind: "ducks" }, x: dx, y: dy, r: 18, hint: "shoo the ducks" };
  }
  return null;
}

function hitStreet(model: DeepReadonly<Model>, x: number, y: number): Hit | null {
  for (const [i, l] of LAMPS.entries()) {
    if (inRect(x, y, l.x - 12, l.foot - LAMP_H - 18, 24, LAMP_H + 18)) return { target: { kind: "lamp", i }, x: l.x, y: l.foot - LAMP_H, r: 16, hint: lampLit(model, i) ? "put the lamp out" : "light the lamp" };
  }
  const tx = tramX(model.frame);
  if (inRect(x, y, tx, RAIL_Y + 4 - TRAM_H, TRAM_W, TRAM_H)) return { target: { kind: "tram" }, x: tx + TRAM_W / 2, y: RAIL_Y - 34, r: 70, hint: "ring the tram bell" };
  if (balloonHeld(model) && inRect(x, y, MOUSE.x - 22, BACK_FEET - 120, 50, 120)) return { target: { kind: "balloon" }, x: MOUSE.x + 8, y: BACK_FEET - 80, r: 28, hint: "let go of the balloon" };
  return null;
}

const SHOP_HINTS: Record<string, { kind: "bakery" | "cafe" | "florist" | "fish" | "books" | "house"; hint: string }> = {
  bakery: { kind: "bakery", hint: "fresh buns?" },
  cafe: { kind: "cafe", hint: "pour the tea" },
  florist: { kind: "florist", hint: "a breeze through the flowers" },
  fish: { kind: "fish", hint: "something in the canal" },
  books: { kind: "books", hint: "open late" },
};

function hitBuildings(model: DeepReadonly<Model>, x: number, y: number): Hit | null {
  for (const w of WINDOWS) {
    if (inRect(x, y, w.x - 4, w.y - 4, w.w + 8, w.h + 8)) return { target: { kind: "window", i: w.i }, x: w.x + w.w / 2, y: w.y + w.h / 2, r: 20, hint: windowLit(model, w.i) ? "lights out" : "lights on" };
  }
  if (Math.hypot(x - MILL.x, y - MILL.y) < MILL.r + 6) return { target: { kind: "mill" }, x: MILL.x, y: MILL.y, r: MILL.r, hint: "a gust for the mill" };
  if (inRect(x, y, TOWER.x - 6, TOWER.top - TOWER.spire - 40, TOWER.w + 12, BASE - TOWER.top + TOWER.spire + 40) || inRect(x, y, HALL.x, HALL.top - 20, HALL.w, BASE - HALL.top + 20)) {
    return { target: { kind: "bell" }, x: TOWER.x + TOWER.w / 2, y: TOWER.top + 34, r: 34, hint: "ring the bell" };
  }
  for (const b of BUILDINGS) {
    const top = b.top - (b.roof === "steep" ? 78 : b.roof === "gable" ? 54 : 16);
    if (!inRect(x, y, b.x, top, b.w, BASE - top + 14)) continue;
    const shop = SHOP_HINTS[b.id] ?? { kind: "house", hint: "" };
    return { target: { kind: shop.kind }, x: b.x + b.w / 2, y: BASE - 50, r: 44, hint: shop.hint };
  }
  return null;
}

const PEOPLE_HINTS: Record<Who, string> = {
  heron: "post!", goose: "say hello", mole: "the evening paper", badger: "a tune?", hedgehog: "sweep, sweep",
  mouse: "hello, little one", otter: "tea for two", cyclist: "ring-a-ling", cart: "fresh veg",
};

function hitPeople(model: DeepReadonly<Model>, x: number, y: number, a: { folk: number; lane: 0 | 1 }): Hit | null {
  const f = model.frame;
  const people = WALKERS.slice(0, a.folk).filter((w) => w.lane === a.lane);
  for (const w of people) {
    const p = walkerAt(w, f);
    const half = Math.max(16, 22 * p.scale), tall = (w.kind === "heron" || w.kind === "goose" ? 96 : 78) * p.scale;
    if (inRect(x, y, p.x - half, p.feet - tall, half * 2, tall + 4)) return { target: { kind: "folk", who: w.kind }, x: p.x, y: p.feet - tall / 2, r: tall / 2 + 4, hint: PEOPLE_HINTS[w.kind] };
  }
  if (a.lane === 1 && a.folk >= 9) {
    const cx = cartX(f);
    if (inRect(x, y, cx - 40, CART_FEET - 46, 80, 48)) return { target: { kind: "folk", who: "cart" }, x: cx, y: CART_FEET - 22, r: 36, hint: PEOPLE_HINTS.cart };
  }
  return null;
}

function hitCyclist(model: DeepReadonly<Model>, x: number, y: number, folk: number): Hit | null {
  if (folk < 8) return null;
  const cx = cyclistX(model.frame);
  return inRect(x, y, cx - 34, CYCLIST_FEET - 70, 68, 72) ? { target: { kind: "folk", who: "cyclist" }, x: cx, y: CYCLIST_FEET - 34, r: 36, hint: PEOPLE_HINTS.cyclist } : null;
}

/** Whether a building, the hall or the tower (with their roofs) covers (x, y). */
function buildingCovers(x: number, y: number): boolean {
  const under = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]): boolean => {
    const s1 = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const s2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
    const s3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
  for (const b of BUILDINGS) {
    const flatTop = b.top - (b.roof === "mansard" ? 16 : b.roof === "flat" ? 10 : 0);
    if (inRect(x, y, b.x - 6, flatTop, b.w + 12, BASE - flatTop)) return true;
    if (b.roof === "gable" || b.roof === "steep") {
      const peak = b.top - (b.roof === "gable" ? 54 : 78);
      if (under([b.x - 8, b.top + 2], [b.x + b.w / 2, peak], [b.x + b.w + 8, b.top + 2])) return true;
    }
    if (b.roof === "step" && inRect(x, y, b.x + b.w / 3, b.top - 8, b.w / 3, 10)) return true;
  }
  if (inRect(x, y, TOWER.x - 6, TOWER.top, TOWER.w + 12, BASE - TOWER.top)) return true;
  return under([TOWER.x - 6, TOWER.top + 2], [TOWER.x + TOWER.w / 2, TOWER.top - TOWER.spire - 40], [TOWER.x + TOWER.w + 6, TOWER.top + 2]);
}

function hitHotAir(model: DeepReadonly<Model>, x: number, y: number): Hit | null {
  const [hx, hy] = hotAirAt(model.frame, model.hotAir);
  // The balloon flies behind the town: where a roof is in front of it, the roof is what is clicked.
  return inRect(x, y, hx, hy, HOT_AIR.w, HOT_AIR.h) && !buildingCovers(x, y) ? { target: { kind: "hotair" }, x: hx + HOT_AIR.w / 2, y: hy + HOT_AIR.h / 2 - 8, r: 44, hint: "fire the burner" } : null;
}

/** What is under (x, y) in the frame the model shows; the front-most thing wins. */
export function hitTest(model: DeepReadonly<Model>, x: number, y: number, folk: number): Hit | null {
  const hit = hitWater(model, x, y)
    ?? hitPeople(model, x, y, { folk, lane: 1 })
    ?? hitCyclist(model, x, y, folk)
    ?? hitStreet(model, x, y)
    ?? hitPeople(model, x, y, { folk, lane: 0 })
    ?? hitHotAir(model, x, y)
    ?? hitBuildings(model, x, y);
  if (hit) return hit;
  if (y < 300) return { target: { kind: "sky" }, x, y, r: 0, hint: nightOf(model.clock) > 0.4 ? "a firework" : "" };
  return null;
}

export function hitId(t: Target): string {
  return t.kind === "window" || t.kind === "lamp" ? `${t.kind}-${t.i}` : t.kind === "folk" ? t.who : t.kind;
}
