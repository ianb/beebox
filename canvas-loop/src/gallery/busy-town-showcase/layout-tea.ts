// Where everything in Thimble Quay stands, and where the moving things are at a
// given frame. `update` hit-tests with these and `draw` paints with them, so a
// click lands on what the frame shows.
import { hash } from "./ink-tea.js";

export const W = 960;
export const H = 600;
/** Building fronts stand on this line (the back pavement's top). */
export const BASE = 420;
export const ROAD_TOP = 442;
export const ROAD_BOT = 500;
export const CANAL_TOP = 530;
/** Where feet stand in each lane. */
export const BACK_FEET = 436;
export const FRONT_FEET = 520;
export const RAIL_Y = 482;
export const WIRE_Y = 352;

export type Roof = "gable" | "flat" | "mansard" | "step" | "steep";
export interface Building {
  readonly id: string;
  readonly x: number;
  readonly w: number;
  readonly top: number;
  readonly wall: string;
  readonly trim: string;
  readonly roof: Roof;
  readonly roofColour: string;
  readonly sign: string;
  readonly signFill: string;
  readonly signInk: string;
  readonly rows: number;
  readonly cols: number;
}

export const BUILDINGS: readonly Building[] = [
  { id: "bakery", x: 12, w: 152, top: 196, wall: "#e9b88c", trim: "#fff4e0", roof: "gable", roofColour: "#b24f39", sign: "Crumb & Crust", signFill: "#5b2e22", signInk: "#ffe7b8", rows: 2, cols: 3 },
  { id: "books", x: 280, w: 128, top: 158, wall: "#7d9cbc", trim: "#eef2f6", roof: "flat", roofColour: "#3d4e66", sign: "Lantern Books", signFill: "#1e3550", signInk: "#f7d77c", rows: 3, cols: 3 },
  { id: "cafe", x: 416, w: 152, top: 192, wall: "#efd27c", trim: "#fffbe8", roof: "mansard", roofColour: "#4a4250", sign: "The Kettle", signFill: "#a8322c", signInk: "#fff3d6", rows: 2, cols: 4 },
  { id: "fish", x: 576, w: 116, top: 176, wall: "#97c4a5", trim: "#f2fbf3", roof: "step", roofColour: "#507a63", sign: "Pike & Pail", signFill: "#24485a", signInk: "#e6f4f4", rows: 2, cols: 3 },
  { id: "house", x: 700, w: 92, top: 130, wall: "#d98f8a", trim: "#fff2ee", roof: "steep", roofColour: "#5c3b46", sign: "", signFill: "", signInk: "", rows: 3, cols: 2 },
  { id: "florist", x: 800, w: 148, top: 292, wall: "#c4b0d8", trim: "#fbf6ff", roof: "flat", roofColour: "#5d4e72", sign: "Thistle & Fern", signFill: "#3f5a2e", signInk: "#f4f0d0", rows: 0, cols: 3 },
];

/** The town hall and its clock tower, between the bakery and the books. */
export const HALL = { x: 172, w: 100, top: 236 } as const;
export const TOWER = { x: 192, w: 60, top: 84, spire: 40 } as const;
export const CLOCK = { x: 222, y: 168, r: 21 } as const;
/** The ledge the pigeons sit on. */
export const LEDGE_Y = 84;

/** The ground floor of a shop: a shop window and a door. */
export const SHOP_H = 92;

/** A shop's display window: the glass, between its left edge and its door. */
export function shopWindow(b: Building): { x: number; y: number; w: number; h: number } | null {
  if (b.id === "house") return null;
  const doorX = b.x + b.w - 26 - 12;
  return { x: b.x + 10, y: BASE - SHOP_H + 17, w: doorX - b.x - 20, h: SHOP_H - 34 };
}

export interface Win {
  readonly i: number;
  readonly b: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The night level (0..1) at which this window's lamp comes on by itself. */
  readonly on: number;
}

function windowsOf(b: Building, bi: number, start: number): Win[] {
  const top = b.top + (b.roof === "mansard" ? 34 : b.roof === "flat" ? 24 : 16);
  const bottom = BASE - SHOP_H - 26;
  const rowH = (bottom - top) / b.rows;
  const colW = b.w / b.cols;
  const out: Win[] = [];
  for (let r = 0; r < b.rows; r++) {
    for (let c = 0; c < b.cols; c++) {
      const w = Math.min(24, colW * 0.52), h = Math.min(34, rowH * 0.66);
      const x = b.x + colW * (c + 0.5) - w / 2;
      const y = top + rowH * (r + 0.5) - h / 2 + 4;
      out.push({ i: start + out.length, b: bi, x, y, w, h, on: 0.25 + hash(bi * 7 + c, r, 5) * 0.6 });
    }
  }
  return out;
}
export const WINDOWS: readonly Win[] = BUILDINGS.reduce<Win[]>((all, b, bi) => [...all, ...windowsOf(b, bi, all.length)], []);

export const LAMPS: readonly { x: number; foot: number }[] = [
  { x: 274, foot: 438 },
  { x: 572, foot: 438 },
  { x: 796, foot: 438 },
  { x: 140, foot: 526 },
  { x: 470, foot: 526 },
  { x: 860, foot: 526 },
];
export const LAMP_H = 74;

/** The windmill on the hill behind the florist. */
export const MILL = { x: 884, y: 206, r: 38 } as const;

/** The mouse with a balloon, by the bookshop door. */
export const MOUSE = { x: 352, y: BACK_FEET } as const;

// --- Moving things -------------------------------------------------------------

/** The tram's cycle: it comes in from the right, waits at the stop, leaves left. */
export const TRAM_PERIOD = 1080;
export const TRAM_W = 214;
export const TRAM_H = 74;
const STOP_X = 452;
export function tramX(frame: number): number {
  const t = frame % TRAM_PERIOD;
  if (t < 260) return W + 40 + (STOP_X - W - 40) * (1 - (1 - t / 260) ** 2);
  if (t < 470) return STOP_X;
  if (t < 760) return STOP_X + (-TRAM_W - 60 - STOP_X) * ((t - 470) / 290) ** 2;
  return -TRAM_W - 400;
}
export function tramStopped(frame: number): boolean {
  const t = frame % TRAM_PERIOD;
  return t >= 260 && t < 470;
}

/** The frog's rowing boat drifts along the canal. */
export function boatX(frame: number): number {
  return 520 + Math.sin(frame / 520) * 330;
}
export const BOAT_Y = 566;

/** A duck's resting place on the canal, which drifts. */
export function duckHome(i: number, frame: number): readonly [number, number] {
  return [180 + i * 46 + Math.sin(frame / 140 + i * 2) * 18, 560 + i * 9 + Math.sin(frame / 50 + i) * 1.5];
}

export interface Hotspot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly hint: string;
}
