// The town's state, the light at a given hour, and what a click at a point hits.
import type { DeepReadonly, Voice } from "@ianbicking/canvas-loop";
import { clamp01, ramp } from "./ink-tea.js";
import { BACK_FEET, BASE, BOAT_Y, BUILDINGS, HALL, LAMPS, LAMP_H, MILL, MOUSE, RAIL_Y, TOWER, TRAM_H, TRAM_W, WINDOWS, boatX, duckHome, tramX } from "./layout-tea.js";

export interface Rocket {
  readonly at: number;
  readonly x: number;
  readonly y: number;
  readonly hue: number;
}

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
  millAngle: number;
  millSpin: number;
  rockets: readonly Rocket[];
  voices: readonly Voice[];
  count: number;
}

export const LASTS = { bell: 360, bakery: 540, balloonPop: 300, balloonBack: 420, rowing: 240, ducks: 300, tram: 50, petals: 320, cafe: 420, fish: 70, rocket: 150 } as const;
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
  | { kind: "bell" | "bakery" | "tram" | "balloon" | "boat" | "ducks" | "mill" | "cafe" | "florist" | "fish" | "house" | "books" | "sky" };

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

/** What is under (x, y) in the frame the model shows; the front-most thing wins. */
export function hitTest(model: DeepReadonly<Model>, x: number, y: number): Hit | null {
  const hit = hitWater(model, x, y) ?? hitStreet(model, x, y) ?? hitBuildings(model, x, y);
  if (hit) return hit;
  if (y < 300) return { target: { kind: "sky" }, x, y, r: 0, hint: nightOf(model.clock) > 0.4 ? "a firework" : "" };
  return null;
}

export function hitId(t: Target): string {
  return t.kind === "window" || t.kind === "lamp" ? `${t.kind}-${t.i}` : t.kind;
}
