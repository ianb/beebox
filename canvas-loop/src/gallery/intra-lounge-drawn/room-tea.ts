// The Archive Lounge, drawn by hand on an isometric floor: bowed walls with riveted
// skirting and pipes, sagging plank floor and a worn rug, a teetering pile of old
// television sets, a sagging tape shelf, a lumpy sofa, a tank of a vending machine.
// Everything here is still; screens and light are drawn per frame (light-tea.ts).
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, blob, ellipsePts, hash, ink, iso, isoBox, rivet, roundRectPts, stroke, wobble } from "./ink-tea.js";

/** Room size along the two walls, and wall height. */
export const RU = 510, RW = 515, WALL = 270;

// --- Television sets --------------------------------------------------------------------

export type Show = "text" | "bars" | "scope" | "hex" | "roll" | "static" | "map";
export interface Telly {
  /** Left edge along the wall, base height, width along the wall, height, depth off the wall. */
  u: number;
  h: number;
  width: number;
  height: number;
  depth: number;
  show: Show;
  /** Body colour. */
  body: string;
  /** How far it leans, radians: the pile teeters. */
  tilt: number;
}
export const TELLIES: readonly Telly[] = [
  { u: 104, h: 48, width: 98, height: 92, depth: 60, show: "text", body: "#b8ab8c", tilt: 0.0 },
  { u: 206, h: 48, width: 86, height: 80, depth: 54, show: "bars", body: "#8e9286", tilt: 0.02 },
  { u: 296, h: 48, width: 88, height: 98, depth: 62, show: "roll", body: "#a8946c", tilt: -0.015 },
  { u: 120, h: 140, width: 78, height: 70, depth: 52, show: "hex", body: "#9a9c8c", tilt: 0.035 },
  { u: 204, h: 128, width: 92, height: 84, depth: 50, show: "static", body: "#b5a588", tilt: -0.02 },
  { u: 302, h: 146, width: 72, height: 64, depth: 54, show: "scope", body: "#8c8070", tilt: 0.05 },
  { u: 146, h: 210, width: 68, height: 60, depth: 46, show: "map", body: "#a39478", tilt: -0.04 },
  { u: 232, h: 212, width: 62, height: 54, depth: 44, show: "text", body: "#b9ac90", tilt: 0.06 },
];

/** Where a set leans from: the middle of its base, on screen. */
export function tiltPivot(t: Telly): Vec2 {
  return iso(t.u + t.width / 2, t.depth / 2, t.h);
}

/** Draws `body` leaning with set t. */
export function leaning(v: View, t: Telly, body: () => void): void {
  const [px, py] = tiltPivot(t);
  v.at({ translate: [px, py], rotate: t.tilt }, () => v.at({ translate: [-px, -py] }, body));
}

/** The screen of a set: its rectangle on the set's front, in the front's own px. */
export function screenRect(t: Telly): { u0: number; h1: number; w: number; h: number } {
  return { u0: t.u + t.width * 0.12, h1: t.h + t.height * 0.86, w: t.width * 0.66, h: t.height * 0.66 };
}

function telly(v: View, t: Telly, seed: number): void {
  const u0 = t.u, u1 = t.u + t.width, d = t.depth, h0 = t.h, h1 = t.h + t.height;
  isoBox(v, { u: [u0, u1], w: [0, d], h: [h0, h1] }, { fill: t.body, light: "#d8ccb0", dark: "#5a5048", seed, line: 2.4 });
  // The screen: a dark, rounded, bulging glass, set in the front.
  const s = screenRect(t);
  const glass = roundRectPts(0, 0, s.w, s.h, Math.min(s.w, s.h) * 0.22).map(([x, y]): Vec2 => iso(s.u0 + x, d + 1, s.h1 - y));
  v.curve(wobble(glass, { seed: seed + 4, amp: 0.8 }), true, { fill: "#141815" });
  v.curve(wobble(glass, { seed: seed + 4, amp: 0.8 }), true, { stroke: INK, weight: 2.4, brush: { preset: "ink", thinning: 0.4 }, gesture: { seed } });
  // Knobs and a speaker grille below the screen.
  for (let k = 0; k < 2; k++) {
    const [kx, ky] = iso(u0 + t.width * (0.84 + 0.0), d + 1, h0 + t.height * (0.6 - k * 0.24));
    v.circle(kx, ky, 4.2, { fill: "#3a302a" });
    v.circle(kx - 1.2, ky - 1.2, 1.4, { fill: "#cbbd9e" });
  }
  for (let g = 0; g < 4; g++) stroke(v, [iso(u0 + t.width * 0.2 + g * 7, d + 1, h0 + 7), iso(u0 + t.width * 0.2 + g * 7, d + 1, h0 + 13)], { seed: seed + 10 + g, weight: 1.2, amp: 0 });
  rivet(v, ...iso(u0 + 6, d + 1, h1 - 6));
  rivet(v, ...iso(u1 - 6, d + 1, h1 - 6));
}

// --- The room ---------------------------------------------------------------------------

function floor(v: View): void {
  // A slab of floor, seen as a diorama: its front edges show its thickness.
  const edge: Vec2[] = [iso(0, RW, 0), iso(RU, RW, 0), iso(RU, 0, 0), iso(RU, 0, -26), iso(RU, RW, -26), iso(0, RW, -26)];
  blob(v, edge, { fill: "#3a2f28", dark: "#1e1814", seed: 5, shadeSide: "bottom", amp: 2.4 });
  const top: Vec2[] = [iso(0, 0), iso(RU, 0), iso(RU, RW), iso(0, RW)];
  blob(v, top, { fill: "#5c4a3a", light: "#7a6450", dark: "#3e3228", seed: 7, amp: 2.6 });
  // Planks, warped, along the room.
  for (let w = 34; w < RW; w += 34 + hash(w, 0, 3) * 6) {
    stroke(v, [iso(4, w), iso(RU * 0.5, w + (hash(w, 1, 4) - 0.5) * 6), iso(RU - 4, w + (hash(w, 2, 5) - 0.5) * 8)], { seed: 100 + w, weight: 1.1, colour: "#2e241d", amp: 1.5 });
    for (let u = 60 + hash(w, 3, 6) * 120; u < RU - 20; u += 140 + hash(w, Math.round(u), 7) * 80) {
      stroke(v, [iso(u, w), iso(u + 3, w + 30)], { seed: 200 + w + Math.round(u), weight: 1, colour: "#2e241d", amp: 0.5 });
    }
  }
  // The worn rug, frayed at its edge, under the sofa and table.
  const rug = ellipsePts(225, 205, 175, 125, 28).map(([u, w]) => iso(u, w));
  blob(v, rug, { fill: "#6e3d36", light: "#8a5246", dark: "#4a2622", seed: 21, amp: 3 });
  const inner = ellipsePts(225, 205, 150, 104, 26).map(([u, w]) => iso(u, w));
  v.curve(wobble(inner, { seed: 22, amp: 1.5 }), true, { stroke: "#b8925c", weight: 2.5, brush: { preset: "chalk", opacity: 0.7 }, gesture: { seed: 22 } });
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const [x0, y0] = iso(225 + Math.cos(a) * 175, 205 + Math.sin(a) * 125);
    const [x1, y1] = iso(225 + Math.cos(a) * 184, 205 + Math.sin(a) * 133);
    v.line(x0, y0, x1 + (hash(i, 0, 23) - 0.5) * 3, y1, { stroke: "#8a5246", weight: 1.2 });
  }
}

function walls(v: View): void {
  // The two far walls, their tops bowed, their plaster stained above riveted plates.
  const right: Vec2[] = [iso(0, 0, 0), iso(RU * 0.5, 0, 0), iso(RU, 0, 0), iso(RU, 0, WALL - 22), iso(RU * 0.5, 0, WALL + 6), iso(0, 0, WALL)];
  const left: Vec2[] = [iso(0, RW, 0), iso(0, RW * 0.5, 0), iso(0, 0, 0), iso(0, 0, WALL), iso(0, RW * 0.5, WALL - 4), iso(0, RW, WALL - 30)];
  blob(v, left, { fill: "#56655d", light: "#6f7f74", dark: "#3e4a44", seed: 31, shadeSide: "left", amp: 2.2 });
  blob(v, right, { fill: "#66756b", light: "#7d8c80", dark: "#4a564f", seed: 33, amp: 2.2 });
  // Water stains running down from the top.
  for (let i = 0; i < 5; i++) {
    const u = 40 + hash(i, 0, 35) * 440;
    stroke(v, [iso(u, 0, WALL - 8), iso(u + 4, 0, WALL - 60 - hash(i, 1, 36) * 80)], { seed: 300 + i, weight: 7, colour: "rgba(60,70,60,0.35)", amp: 2 });
  }
  // Riveted plates along the bottom of both walls.
  for (const side of ["right", "left"] as const) {
    const len = side === "right" ? RU : RW;
    for (let s = 0; s < len; s += 64) {
      const e = Math.min(len, s + 64);
      const at = (a: number, h: number): Vec2 => (side === "right" ? iso(a, 0, h) : iso(0, a, h));
      blob(v, [at(s, 0), at(e, 0), at(e, 58), at(s, 58)], { fill: side === "right" ? "#6a5446" : "#5a463a", light: "#86705e", dark: "#3e3028", seed: 400 + s + (side === "left" ? 1000 : 0), amp: 1, line: 1.8 });
      for (let r = s + 8; r < e - 4; r += 14) {
        rivet(v, ...at(r, 51));
        rivet(v, ...at(r, 7));
      }
      // Rust bleeding from the rivets.
      v.line(...at(s + 20, 50), ...at(s + 22, 30), { stroke: "#7a3a1e", weight: 3, brush: { preset: "wash", opacity: 0.4 }, gesture: { seed: s, faint: true } });
    }
  }
  // The walls' thick tops.
  stroke(v, [iso(0, RW, WALL - 30), iso(0, RW * 0.5, WALL - 4), iso(0, 0, WALL), iso(RU * 0.5, 0, WALL + 6), iso(RU, 0, WALL - 22)], { seed: 41, weight: 4.5 });
}

/** Pipes climbing the corner, one running along the wall above the sets. */
function pipes(v: View): void {
  for (const [i, [u, w, r]] of ([[16, 12, 9], [36, 6, 6]] as const).entries()) {
    const [x, yb] = iso(u, w, 0), [, yt] = iso(u, w, WALL + 4);
    blob(v, [[x - r, yb], [x + r, yb], [x + r, yt], [x - r, yt]], { fill: i === 0 ? "#7d6a52" : "#8a5a3e", light: "#b49a76", dark: "#4a3a2c", seed: 51 + i, shadeSide: "right", line: 2 });
    for (let h = 40; h < WALL; h += 70 + i * 13) {
      const [, y] = iso(u, w, h);
      blob(v, [[x - r - 2.5, y - 4], [x + r + 2.5, y - 4], [x + r + 2.5, y + 4], [x - r - 2.5, y + 4]], { fill: "#5e4c3c", seed: 60 + h + i, line: 1.6, amp: 0.5 });
    }
  }
  // A valve wheel on the big pipe.
  const [vx, vy] = iso(16, 12, 150);
  v.circle(vx + 15, vy, 10, { stroke: "#8a2e22", weight: 3 });
  for (let k = 0; k < 3; k++) v.line(vx + 15, vy, vx + 15 + Math.cos(k * 2.1) * 9, vy + Math.sin(k * 2.1) * 9, { stroke: "#8a2e22", weight: 2 });
  v.circle(vx + 15, vy, 10, { stroke: INK, weight: 1.2 });
  // Along the wall, sagging between brackets, then dropping behind the sets.
  const run: Vec2[] = [iso(20, 8, 236), iso(150, 8, 230), iso(280, 8, 234), iso(380, 8, 228), iso(410, 8, 210)];
  const tube = v.tube(run, { width: 13 });
  v.path(tube, { fill: "#7a6650" });
  v.path(tube, ink(70, 2));
  stroke(v, run.map(([x, y]): Vec2 => [x, y - 3]), { seed: 71, weight: 2.5, colour: "#b49a76", amp: 0.6 });
}

function cabinet(v: View): void {
  const u0 = 96, u1 = 392, d = 70, h = 48;
  isoBox(v, { u: [u0, u1], w: [0, d], h: [0, h] }, { fill: "#5e4030", light: "#7a5640", dark: "#3a2618", seed: 81 });
  for (let i = 0; i < 3; i++) {
    const a = u0 + 12 + i * 96;
    blob(v, [iso(a, d + 1, 8), iso(a + 84, d + 1, 8), iso(a + 84, d + 1, 38), iso(a, d + 1, 38)], { fill: "#6c4a36", dark: "#3a2618", seed: 82 + i, line: 1.4, amp: 0.8 });
    const [kx, ky] = iso(a + 42, d + 1, 23);
    v.circle(kx, ky, 3, { fill: "#c9a46a" });
  }
}

/** Cables hanging from the sets and snaking off across the floor. */
function cables(v: View): void {
  const lines: Vec2[][] = [
    [iso(120, 50, 48), iso(110, 90, 10), iso(80, 160, 0), iso(30, 260, 0), iso(8, 330, 2)],
    [iso(240, 50, 48), iso(260, 110, 4), iso(330, 150, 0), iso(420, 140, 0), iso(470, 90, 10)],
    [iso(330, 56, 50), iso(360, 90, 18), iso(400, 80, 0), iso(450, 40, 4)],
    [iso(180, 46, 214), iso(150, 70, 160), iso(108, 66, 140)],
  ];
  for (const [i, line] of lines.entries()) stroke(v, line, { seed: 90 + i, weight: 3.2, colour: i % 2 === 0 ? "#1c1814" : "#3a2e3a", amp: 1.5 });
}

/** The doorway to the Archive Console: an arch in the right-hand wall. */
function consoleDoor(v: View): void {
  const pts: Vec2[] = [];
  const c = 432, half = 32, spring = 120;
  pts.push(iso(c - half, 0, 0), iso(c + half, 0, 0));
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI;
    pts.push(iso(c + Math.cos(a) * half, 0, spring + Math.sin(a) * half));
  }
  v.curve(wobble(pts, { seed: 111, amp: 1.2 }), true, { fill: "#2a1a26" });
  v.curve(wobble(pts, { seed: 111, amp: 1.2 }), true, ink(111, 3));
}

/** The shelf of archive tapes on the left wall, sagging under its load. */
function shelves(v: View): void {
  const w0 = 70, w1 = 330, depth = 40;
  for (const [row, h] of [70, 130, 190].entries()) {
    const sag = 7;
    // The board itself, bowed down in the middle, on two brackets.
    const board: Vec2[] = [];
    for (let i = 0; i <= 8; i++) {
      const w = w0 + ((w1 - w0) * i) / 8;
      board.push(iso(depth + 4, w, h - Math.sin((i / 8) * Math.PI) * sag));
    }
    for (let i = 8; i >= 0; i--) {
      const w = w0 + ((w1 - w0) * i) / 8;
      board.push(iso(0, w, h - 5 - Math.sin((i / 8) * Math.PI) * sag));
    }
    blob(v, board, { fill: "#7a5638", light: "#9a7450", dark: "#4a3220", seed: 140 + row, line: 2 });
    // Things on the shelf: reels in cases, binders, boxes, drawn on the shelf's front.
    for (let w = w0 + 6; w < w1 - 20;) {
      const kind = hash(row, w, 121);
      const width = kind < 0.4 ? 22 : kind < 0.75 ? 11 : 30;
      const height = kind < 0.4 ? 40 : kind < 0.75 ? 46 - hash(row, w, 122) * 8 : 30;
      const mid = Math.sin(((w - w0) / (w1 - w0)) * Math.PI) * sag;
      const base = h - mid + 1;
      const colours = ["#c2ae84", "#6d7458", "#844a3a", "#43506a", "#a99678", "#5d554c"];
      const fill = colours[Math.floor(hash(row, w, 123) * colours.length)] ?? "#c2ae84";
      const front = (a: number, b: number): Vec2 => iso(depth, a, b);
      blob(v, [front(w, base), front(w + width, base), front(w + width, base + height), front(w, base + height)], { fill, dark: "#2a201a", seed: 130 + row * 100 + w, line: 1.4, amp: 0.7 });
      if (kind < 0.4) {
        const [rx, ry] = front(w + width / 2, base + height * 0.55);
        v.ellipse(rx, ry, 7, 8, { fill: "#1e1a18" });
        v.ellipse(rx, ry, 2.5, 3, { fill: "#c8b898" });
      }
      w += width + 2 + hash(row, w, 124) * 3;
    }
  }
  // The archive machine under the shelf: dials, a slot, its status lights (drawn per frame).
  const m0 = 210, m1 = 320, mh = 56;
  isoBox(v, { u: [0, 48], w: [m0, m1], h: [0, mh] }, { fill: "#5a6a6a", light: "#7a8c8a", dark: "#2e3a3a", seed: 151 });
  for (let i = 0; i < 3; i++) {
    const [dx, dy] = iso(49, m0 + 22 + i * 32, 34);
    v.circle(dx, dy, 8, { fill: "#d8ccb0" });
    v.circle(dx, dy, 8, ink(152 + i, 1.6));
    v.line(dx, dy, dx + Math.cos(i * 1.9 + 0.5) * 6, dy + Math.sin(i * 1.9 + 0.5) * 6, { stroke: "#8a2e22", weight: 1.5 });
  }
}

/** A lumpy sofa with its back to us, facing the sets; someone on it. Drawn far to
 * near: the far arm, the seat, the sitter, the back, the near arm. */
function sofa(v: View): void {
  const u0 = 120, u1 = 330, w0 = 220, w1 = 298;
  const fabric = { fill: "#8c6b3e", light: "#a8844e", dark: "#5a4224" };
  isoBox(v, { u: [u0 - 26, u0], w: [w0 - 4, w1 + 2], h: [0, 72] }, { ...fabric, seed: 160 });
  isoBox(v, { u: [u0, u1], w: [w0, w1 - 20], h: [8, 46] }, { fill: "#7a5c34", light: "#93703f", dark: "#4a3820", seed: 162 });
  // Someone, sitting, their head and shoulders over the back.
  const [px, py] = iso(205, 252, 78);
  blob(v, ellipsePts(px, py - 4, 25, 19, 16), { fill: "#3c4a6a", light: "#56668a", dark: "#232c44", seed: 171, line: 2 });
  blob(v, ellipsePts(px + 3, py - 33, 13, 15, 14), { fill: "#2e1f18", light: "#4a3226", seed: 172, line: 2 });
  isoBox(v, { u: [u0, u1], w: [w1 - 24, w1], h: [8, 100] }, { ...fabric, seed: 163 });
  // Cushion seams on the back, and a sewn-on patch.
  for (const a of [u0 + 70, u0 + 140]) stroke(v, [iso(a, w1 + 1, 14), iso(a + 1, w1 + 1, 50), iso(a, w1 + 1, 96)], { seed: 164 + a, weight: 1.6, colour: "#4a3820" });
  const patch: Vec2[] = [iso(250, w1 + 1, 50), iso(276, w1 + 1, 48), iso(274, w1 + 1, 72), iso(252, w1 + 1, 74)];
  blob(v, patch, { fill: "#5a6a4a", seed: 167, line: 1.4 });
  for (let i = 0; i < 6; i++) {
    const [sx, sy] = iso(250 + i * 5, w1 + 1, 49 - i * 0.4);
    v.line(sx, sy - 2, sx + 1, sy + 2, { stroke: "#e8dcc0", weight: 1 });
  }
  isoBox(v, { u: [u1, u1 + 26], w: [w0 - 4, w1 + 2], h: [0, 72] }, { ...fabric, seed: 168 });
}

function table(v: View): void {
  const u0 = 165, u1 = 285, w0 = 118, w1 = 172, h = 40;
  for (const [u, w] of [[u0 + 8, w1 - 6], [u1 - 8, w1 - 6], [u0 + 12, w0 + 4], [u1 - 10, w0 + 6]] as const) {
    stroke(v, [iso(u, w, 0), iso(u + (hash(u, w, 181) - 0.5) * 6, w, h)], { seed: 180 + u + w, weight: 3.4, colour: "#3a2618" });
  }
  isoBox(v, { u: [u0, u1], w: [w0, w1], h: [h - 7, h] }, { fill: "#6a4630", light: "#8a6242", dark: "#3a2618", seed: 185 });
  // Cans and a mug, abandoned.
  for (const [i, [u, w, c]] of ([[190, 140, "#b8bcc0"], [232, 150, "#9a3a30"], [262, 132, "#d8ccb0"]] as const).entries()) {
    const [x, y] = iso(u, w, h);
    blob(v, [[x - 5, y], [x + 5, y], [x + 5, y - 14], [x - 5, y - 14]], { fill: c, seed: 190 + i, line: 1.4, amp: 0.5 });
    v.ellipse(x, y - 14, 5, 2, { fill: "rgba(255,255,255,0.35)" });
  }
}

/** A round tank of a vending machine, dented and riveted, with a window of drinks. */
export const VENDING_AT = { u: 478, w: 58 };
function vending(v: View): void {
  const [cx, cy] = iso(VENDING_AT.u, VENDING_AT.w, 0);
  const r = 46, h = 196;
  const body: Vec2[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    body.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5]);
  }
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    body.push([cx + Math.cos(a) * r * (1 - Math.sin((i / 12) * Math.PI) * 0.08), cy - h + Math.sin(a) * r * 0.9]);
  }
  blob(v, body, { fill: "#8a3e2e", light: "#a85840", dark: "#4a1e16", seed: 201, shadeSide: "right", amp: 2 });
  // Bands of rivets.
  for (const hb of [24, 120]) {
    const band: Vec2[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      band.push([cx + Math.cos(a) * r, cy - hb + Math.sin(a) * r * 0.5]);
    }
    stroke(v, band, { seed: 202 + hb, weight: 2 });
    for (let i = 1; i < 10; i += 2) {
      const a = (i / 10) * Math.PI;
      rivet(v, cx + Math.cos(a) * r * 0.98, cy - hb + 4 + Math.sin(a) * r * 0.49);
    }
  }
  // The window frame (the glow inside is drawn per frame), a coin slot, a dent.
  blob(v, roundRectPts(cx - 28, cy - 150, 46, 84, 16), { fill: "#2a2028", seed: 205, line: 2.6 });
  blob(v, roundRectPts(cx + 22, cy - 112, 9, 22, 3), { fill: "#c9b79a", seed: 206, line: 1.4 });
  v.line(cx + 26.5, cy - 108, cx + 26.5, cy - 94, { stroke: INK, weight: 2 });
  blob(v, roundRectPts(cx - 18, cy - 46, 30, 14, 5), { fill: "#1a1416", seed: 207, line: 1.8 });
  stroke(v, [[cx + 10, cy - 172], [cx + 20, cy - 166], [cx + 16, cy - 158]], { seed: 208, weight: 1.4 });
}

/** Grime: hatched shade in the corners and along the walls' feet, scuffs on the floor. */
function grime(v: View): void {
  const pencil = { preset: "pencil" as const, opacity: 0.45 };
  for (let i = 0; i < 90; i++) {
    const along = hash(i, 0, 601);
    const right = i % 2 === 0;
    const [x, y] = right ? iso(along * RU, 2, 0) : iso(2, along * RW, 0);
    const len = 12 + hash(i, 1, 602) * 30;
    v.line(x, y - len, x + (right ? 6 : -6), y + 2, { stroke: "#1e1a1c", weight: 1.2, brush: pencil, gesture: { seed: 600 + i, faint: true } });
  }
  // Up the back corner, dark.
  for (let i = 0; i < 30; i++) {
    const [x, y] = iso(0, 0, hash(i, 2, 603) * WALL);
    v.line(x - 30 + hash(i, 3, 604) * 30, y, x + hash(i, 4, 605) * 30, y + 14, { stroke: "#16141a", weight: 1, brush: pencil, gesture: { seed: 650 + i, faint: true } });
  }
  for (let i = 0; i < 26; i++) {
    const [x, y] = iso(40 + hash(i, 5, 606) * 440, 300 + hash(i, 6, 607) * 200);
    v.line(x, y, x + 14 + hash(i, 7, 608) * 20, y + (hash(i, 8, 609) - 0.5) * 6, { stroke: "#2a221c", weight: 1.4, brush: pencil, gesture: { seed: 700 + i, faint: true } });
  }
}

/** A bare bulb on a cord, over the table. */
function bulb(v: View): void {
  const [bx, by] = iso(225, 145, 210);
  stroke(v, [[bx, 0], [bx + 2, by - 60], [bx, by - 12]], { seed: 801, weight: 1.6 });
  blob(v, roundRectPts(bx - 5, by - 14, 10, 8, 2), { fill: "#3a302a", seed: 802, line: 1.4 });
  blob(v, ellipsePts(bx, by + 2, 8, 10, 14), { fill: "#d8d0b0", light: "#f0ead0", seed: 803, line: 1.6 });
}

/** The still part of the room, back to front. */
export function paintRoom(v: View): void {
  v.background("#14121a");
  walls(v);
  pipes(v);
  consoleDoor(v);
  floor(v);
  shelves(v);
  cabinet(v);
  for (const [i, t] of TELLIES.entries()) leaning(v, t, () => telly(v, t, 500 + i * 20));
  cables(v);
  table(v);
  sofa(v);
  vending(v);
  grime(v);
  bulb(v);
  v.paperTexture(0.4);
}

export { iso };
