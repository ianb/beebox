// The still parts of the file room: wall, floor, cabinets, drawer faces, the
// high windows and the lamp cords. `roomPicture` is drawn once and cached.
import type { Drawing, Picture, Style, View } from "@ianbicking/canvas-loop";
import { CAB_W, FLOOR, LAMPS, STEEL, TALL, cabRows, cabTop, hash, slotOf } from "./file-room-layout-tea.js";

export const CREAM = "#e9dfc3";
export const BRASS = "#a98a4a";

const LABELS = ["A-C", "D-F", "G-J", "K-M", "N-P", "Q-S", "T-V", "W-Z", "1931", "1932", "1933", "1934", "Misc", "Paid", "Open"] as const;
const WOOD_FACE = "#6b4630";
const STEEL_FACE = "#4d5c63";

function shade(color: string, amount: number): string {
  return amount >= 0 ? `color-mix(in oklab, ${color}, white ${Math.round(amount * 100)}%)` : `color-mix(in oklab, ${color}, black ${Math.round(-amount * 100)}%)`;
}

export interface FaceSpec {
  cab: number;
  row: number;
  /** 0 closed .. 1 fully open: an open drawer casts a shadow. */
  open: number;
}

/** A drawer face centred on (0, 0): panel, grain, label holder and pull. */
export function drawerFace(v: View, spec: FaceSpec): Drawing {
  const { cab, row, open } = spec;
  const steel = STEEL[cab] === true;
  const n = cab * 10 + row;
  const face = shade(steel ? STEEL_FACE : WOOD_FACE, (hash(n) - 0.5) * 0.06);
  const w = CAB_W - 24;
  const grain: Style = { stroke: steel ? "rgba(255,255,255,0.05)" : "rgba(20,10,5,0.28)", weight: 1.2 };
  return [
    v.roundRect(-w / 2, -44, w, 88, 3, { fill: face, stroke: "rgba(0,0,0,0.5)", weight: 2, material: { bevel: 3, relief: 0.25, shine: steel ? 0.25 : 0.05, castsShadow: open > 0 ? 18 : false } }),
    v.roundRect(-w / 2 + 7, -37, w - 14, 74, 2, { fill: "rgba(0,0,0,0)", stroke: "rgba(0,0,0,0.28)", weight: 1.5 }),
    [0, 1, 2].map((i) => {
      const y = -12 + i * 17 + (hash(n + i) - 0.5) * 6;
      return v.line(-w / 2 + 12 + hash(n * 3 + i) * 20, y, w / 2 - 12 - hash(n * 5 + i) * 30, y + (hash(n + 9 * i) - 0.5) * 3, grain);
    }),
    v.rect(-26, -32, 52, 20, { fill: BRASS, material: { bevel: 1.5, shine: 0.5 } }),
    v.rect(-22, -29, 44, 14, { fill: CREAM }),
    v.text(LABELS[(cab + row * 3) % LABELS.length] ?? "A-C", { x: 0, y: -22 }, { size: 11, font: "Georgia, serif", style: "bold", fill: "#3a2e22", align: "center", valign: "middle" }),
    v.roundRect(-20, 8, 40, 9, 4, { fill: BRASS, material: { bevel: 3, shine: 0.7 } }),
    v.rect(-20, 17, 40, 3, { fill: "rgba(0,0,0,0.3)" }),
  ];
}

function cabinet(v: View, c: number): Drawing {
  const x = c * CAB_W + 4;
  const top = cabTop(c);
  const steel = STEEL[c] === true;
  return [
    v.rect(x, top, CAB_W - 8, FLOOR - top, { fill: steel ? "#38454c" : "#4a3223", material: { bevel: 4, relief: 0.2, castsShadow: 20 } }),
    v.rect(x - 2, top - 7, CAB_W - 4, 8, { fill: steel ? "#56666e" : "#6a4a35", material: { bevel: 2, shine: 0.15 } }),
    v.rect(x + 2, FLOOR - 14, CAB_W - 12, 14, { fill: "#1d1713", material: { bevel: 1 } }),
    Array.from({ length: cabRows(c) }, (_, row) => {
      const s = slotOf(c, row);
      return [v.rect(s.x + 2, s.y, s.w - 4, s.h, { fill: "#120d0a" }), v.at({ translate: [s.x + s.w / 2, s.y + s.h / 2] }, drawerFace(v, { cab: c, row, open: 0 }))];
    }),
  ];
}

function boxesOnTop(v: View, c: number): Drawing {
  const top = cabTop(c) - 7;
  const x = c * CAB_W;
  const edge: Style = { stroke: "rgba(0,0,0,0.4)", weight: 1.5 };
  return [
    v.rect(x + 22, top - 46, 70, 46, { ...edge, fill: "#6b5a3c", material: { bevel: 2, castsShadow: 12 } }),
    v.rect(x + 22, top - 58, 70, 12, { ...edge, fill: "#7b6a47", material: { bevel: 2 } }),
    v.rect(x + 50, top - 36, 26, 14, { fill: CREAM }),
    v.rect(x + 104, top - 36, 66, 36, { ...edge, fill: "#4b5546", material: { bevel: 2, castsShadow: 10 } }),
    v.rect(x + 122, top - 26, 28, 12, { fill: CREAM }),
  ];
}

function bankerBase(v: View, x: number): Drawing {
  const y = cabTop(1) - 7;
  return [
    v.ellipse(x, y - 4, 30, 7, { fill: "#2c2a22", material: { bevel: 2, shine: 0.6 } }),
    v.rect(x - 30, y - 12, 60, 8, { fill: "#2c2a22", material: { bevel: 2, shine: 0.6 } }),
    v.rect(x - 4, y - 52, 8, 42, { fill: BRASS, material: { bevel: 2, shine: 0.8 } }),
  ];
}

function floorClutter(v: View): Drawing {
  const edge: Style = { stroke: "rgba(0,0,0,0.4)", weight: 1.5 };
  return [
    v.rect(60, 800, 110, 60, { ...edge, fill: "#6b5a3c", material: { bevel: 2, castsShadow: 14 } }),
    v.rect(76, 810, 40, 16, { fill: CREAM }),
    v.rect(1400, 810, 100, 50, { ...edge, fill: "#4b5546", material: { bevel: 2, castsShadow: 14 } }),
    v.polygon([[1180, 850], [1230, 842], [1250, 860], [1196, 868]], { fill: CREAM }),
    v.polygon([[620, 830], [668, 822], [684, 838], [632, 848]], { fill: "#d6c9a6" }),
  ];
}

/** The wall, floor, cabinets and the lamp cords and banker's lamp bases: drawn once. */
export function roomPicture(v: View): Picture {
  return v.picture({ key: "room", width: 1600, height: 900 }, () => [
    v.rect(0, 0, 1600, FLOOR, { fill: "#2b3248", material: { relief: 0.08 } }),
    Array.from({ length: 20 }, (_, i) => v.rect(i * 80, 0, 3, FLOOR, { fill: "rgba(0,0,0,0.16)" })),
    v.rect(0, 238, 1600, 5, { fill: "#1d2233" }),
    v.rect(0, FLOOR, 1600, 140, { fill: "#2a1e17", material: { relief: 0.1 } }),
    Array.from({ length: 22 }, (_, i) => v.line(-40 + i * 80, FLOOR + 2, -240 + i * 100, 900, { stroke: "rgba(8,4,2,0.4)", weight: 1.5 })),
    v.rect(0, FLOOR - 2, 1600, 4, { fill: "rgba(0,0,0,0.5)" }),
    floorClutter(v),
    [2, 3, 5, 7, 0].map((c) => boxesOnTop(v, c)),
    TALL.map((_, c) => cabinet(v, c)),
    LAMPS.map((l) => (l.kind === "pendant" ? v.line(l.x, 0, l.x, 118, { stroke: "#16120f", weight: 3 }) : bankerBase(v, l.x))),
  ]);
}

function window(v: View, x: number): Drawing {
  return [
    v.rect(x, 52, 120, 168, { fill: "#2a2723", material: { bevel: 4 } }),
    v.rect(x + 8, 60, 104, 152, { fill: v.linearGradient(0, 60, 0, 212, [[0, "#1b2a52"], [1, "#31446f"]]), material: { emissive: 0.75 } }),
    v.circle(x + 84, 96, 7, { fill: "#dfe6f3", material: { emissive: 1 } }),
    v.rect(x + 58, 60, 4, 152, { fill: "#2a2723" }),
    v.rect(x + 8, 134, 104, 4, { fill: "#2a2723" }),
    v.rect(x - 6, 218, 132, 8, { fill: "#3b342d", material: { bevel: 2 } }),
  ];
}

/** The two high windows: they glow by themselves, so they are drawn after the lighting multiply. */
export function windowsPicture(v: View): Picture {
  return v.picture({ key: "windows", width: 1600, height: 900 }, () => [window(v, 240), window(v, 1240)]);
}
