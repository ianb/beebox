// Joyous Cafe. From intra-game: "Joyous Cafe: bright flowers adorn the walls, their
// colour shifting with the hour. Tables neatly arranged, upbeat music softly
// playing. Sky of drifting clouds whose speed changes without warning, sometimes
// halting mid-drift."
// Exits (2): Activity Hub (edge-left), Tranquil Pool (door).
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, roundRectPts, stroke } from "./kit-tea.js";
import { hueHex, notes, signBox } from "./parts-a-tea.js";
import { amaEye, amaSpeaker, citizen, pacing, shellChair, tulipTable } from "./props-tea.js";
import { m } from "./sizes-tea.js";

/** The big flowers on the wall: [x m, h m, radius m, petals]. */
const FLOWERS = [[1.45, 2.05, 0.3, 8], [3.75, 2.3, 0.36, 6], [4.45, 1.55, 0.22, 10], [5.25, 2.45, 0.26, 7], [5.6, 1.55, 0.2, 6], [8.25, 1.55, 0.28, 8]] as const;
const TABLES = [1.95, 3.55, 5.15] as const;
const TABLE_DEPTH = 1.45;
const JUKEBOX = { x: 6.35, depth: 0.45, w: 0.85, h: 1.45 };
const B3 = { x: 0.8, depth: 0.4 };
const HATCH = { x: 2.6, h0: 1.12, h1: 1.62, w: 1.1 };

function flowerStatic(v: View): void {
  // Each flower is a wire frame bolted to the wall, with a stem and two leaves;
  // the petals are lit plastic, drawn per frame.
  for (const [i, [x, h, r]] of FLOWERS.entries()) {
    const [cx, cy] = at(x, h, 0);
    stroke(v, [[cx, cy + m(r) * 0.4], [cx + 6, cy + m(r) * 1.4], [cx + 2, cy + m(r) * 2.2]], { seed: 5000 + i, weight: 4, colour: "#3a8a3a" });
    blob(v, [[cx + 4, cy + m(r) * 1.5], [cx + 26, cy + m(r) * 1.2], [cx + 34, cy + m(r) * 1.35], [cx + 12, cy + m(r) * 1.7]], { fill: "#5aa84a", seed: 5010 + i, line: 1.4 });
    blob(v, [[cx + 2, cy + m(r) * 1.8], [cx - 22, cy + m(r) * 1.55], [cx - 28, cy + m(r) * 1.7], [cx - 6, cy + m(r) * 2.0]], { fill: "#4a984a", seed: 5020 + i, line: 1.4 });
  }
}
function flowerLive(v: View, t: number): void {
  // The hour, sped up: every flower drifts round the colour wheel together.
  const base = (t * 1.6) % 360;
  for (const [i, [x, h, r, n]] of FLOWERS.entries()) {
    const [cx, cy] = at(x, h, 0);
    const hue = (base + i * 26) % 360;
    const petal = hueHex(hue, 0.8, 0.62), edge = hueHex(hue, 0.7, 0.35);
    const R = m(r);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i;
      v.ellipse(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, R * 0.42, R * 0.42, { fill: petal, stroke: INK, weight: 1.8 });
    }
    v.circle(cx, cy, R * 0.38, { fill: hueHex((hue + 180) % 360, 0.85, 0.6), stroke: INK, weight: 2 });
    v.circle(cx - R * 0.1, cy - R * 0.1, R * 0.12, { fill: "rgba(255,255,255,0.5)" });
    v.ellipse(cx, cy, R * 1.0, R * 1.0, { stroke: edge, weight: 1, blend: "multiply" });
    glow(v, cx, cy, { rx: R * 1.6, colour: petal, alpha: 0.2 });
  }
}

/** Bouncy Bubble Beverage: a tall dispenser of something fizzy and approved. */
function b3(v: View): void {
  const [px, foot] = at(B3.x, 0, B3.depth);
  const w = m(0.6), h = m(1.7);
  blob(v, [[px - w / 2, foot], [px + w / 2, foot], [px + w / 2, foot - h + 30], [px, foot - h], [px - w / 2, foot - h + 30]], { fill: "#d8402a", light: "#f87a5a", dark: "#7a1a10", seed: 5100, line: 2.4, shadeSide: "right" });
  v.text("B3", { x: px, y: foot - h + 46 }, { size: 22, fill: "#f8f0d0", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
  v.text("BOUNCY BUBBLE", { x: px, y: foot - h + 66 }, { size: 7, fill: "#f8f0d0", align: "center", valign: "middle", style: "bold" });
  v.text("BEVERAGE", { x: px, y: foot - h + 75 }, { size: 7, fill: "#f8f0d0", align: "center", valign: "middle", style: "bold" });
  // The glass tank of it, and a spout, and a cup.
  blob(v, roundRectPts(px - w / 2 + 10, foot - h + 86, w - 20, 70, 10), { fill: "#e8e8b0", seed: 5101, line: 1.8 });
  blob(v, roundRectPts(px - 14, foot - m(0.7), 28, 14, 3), { fill: "#c8c8cc", seed: 5102, line: 1.4 });
  blob(v, [[px - 10, foot - m(0.45)], [px + 10, foot - m(0.45)], [px + 8, foot - m(0.6)], [px - 8, foot - m(0.6)]], { fill: "#f0ece0", seed: 5103, line: 1.4 });
  blob(v, roundRectPts(px - w / 2 + 6, foot - m(0.42), w - 12, 10, 2), { fill: "#5a5a5e", seed: 5104, line: 1.4 });
  v.text("FLAVOUR: YES", { x: px, y: foot - m(0.24) }, { size: 6, fill: "#f8f0d0", align: "center", valign: "middle", style: "bold" });
}
function b3Bubbles(v: View, t: number): void {
  const [px, foot] = at(B3.x, 0, B3.depth);
  const w = m(0.6), top = foot - m(1.7) + 86;
  for (let i = 0; i < 9; i++) {
    const u = (t * 0.02 + hash(i, 0, 5110)) % 1;
    v.circle(px - w / 2 + 18 + hash(i, 1, 5111) * (w - 36), top + 64 - u * 58, 2 + hash(i, 2, 5112) * 2, { stroke: "rgba(160,120,40,0.7)", weight: 1 });
  }
  glow(v, px, top + 35, { rx: 30, ry: 40, colour: "#f8e070", alpha: 0.25 });
}

function hatch(v: View): void {
  const [cx, y0] = at(HATCH.x, HATCH.h1, 0), [, y1] = at(HATCH.x, HATCH.h0, 0);
  const w = m(HATCH.w);
  blob(v, roundRectPts(cx - w / 2 - 10, y0 - 10, w + 20, y1 - y0 + 24, 8), { fill: "#c8c0a8", light: "#e8e0c8", seed: 5200, line: 2.2 });
  blob(v, roundRectPts(cx - w / 2, y0, w, y1 - y0, 4), { fill: "#2a2018", seed: 5201, line: 1.8 });
  // A roller shutter stuck a third of the way down.
  blob(v, [[cx - w / 2, y0], [cx + w / 2, y0], [cx + w / 2, y0 + 30], [cx - w / 2, y0 + 26]], { fill: "#b8b8bc", seed: 5202, line: 1.6 });
  for (let i = 1; i < 5; i++) stroke(v, [[cx - w / 2 + 2, y0 + i * 6], [cx + w / 2 - 2, y0 + i * 6 + (i > 3 ? 2 : 0)]], { seed: 5203 + i, weight: 1, colour: "#6a6a6e", amp: 0.3 });
  // The sill: trays of paste in three shades, a bell.
  blob(v, roundRectPts(cx - w / 2 - 14, y1 - 2, w + 28, 12, 3), { fill: "#e8783a", light: "#f8a06a", seed: 5210, line: 1.8 });
  for (let i = 0; i < 3; i++) {
    const bx = cx - 40 + i * 34;
    blob(v, [[bx - 14, y1 - 2], [bx + 14, y1 - 2], [bx + 10, y1 - 14], [bx - 10, y1 - 14]], { fill: "#f0ece0", seed: 5211 + i, line: 1.4 });
    blob(v, ellipsePts(bx, y1 - 15, 10, 4), { fill: ["#c8b890", "#b8a880", "#d8c8a0"][i] ?? "#c8b890", seed: 5214 + i, line: 1 });
  }
  blob(v, [[cx + 56, y1 - 2], [cx + 72, y1 - 2], [cx + 68, y1 - 12], [cx + 60, y1 - 12]], { fill: "#d8c070", seed: 5220, line: 1.4 });
  v.text("ORDER HERE", { x: cx, y: y0 + 46 }, { size: 9, fill: "#f8e0a0", align: "center", valign: "middle", style: "bold" });
  // The menu board.
  const [mx, my] = at(HATCH.x, 2.32, 0);
  blob(v, roundRectPts(mx - 82, my - 34, 164, 68, 6), { fill: "#2a3a2a", light: "#3a4a3a", seed: 5230, line: 2.4 });
  v.text("TODAY'S MENU", { x: mx, y: my - 22 }, { size: 9, fill: "#f8e070", align: "center", valign: "middle", style: "bold" });
  v.text("PASTE (BEIGE)", { x: mx, y: my - 7 }, { size: 9, fill: "#f0f0e0", align: "center", valign: "middle" });
  v.text("PASTE (LESS BEIGE)", { x: mx, y: my + 6 }, { size: 9, fill: "#f0f0e0", align: "center", valign: "middle" });
  v.text("TOMORROW: PASTE (NEW!)", { x: mx, y: my + 21 }, { size: 8, fill: "#f8a0a0", align: "center", valign: "middle", style: "bold" });
}

function jukebox(v: View): void {
  const [px, foot] = at(JUKEBOX.x, 0, JUKEBOX.depth);
  const w = m(JUKEBOX.w), h = m(JUKEBOX.h);
  const pts: Vec2[] = [[px - w / 2, foot], [px + w / 2, foot], [px + w / 2, foot - h + w / 2]];
  for (let i = 0; i <= 12; i++) pts.push([px + Math.cos((i / 12) * Math.PI) * w / 2, foot - h + w / 2 - Math.sin((i / 12) * Math.PI) * w / 2]);
  pts.push([px - w / 2, foot - h + w / 2]);
  blob(v, pts, { fill: "#8a4a2a", light: "#b06a40", dark: "#4a2414", seed: 5300, line: 2.6, shadeSide: "right" });
  // The window where the record turns, the selector buttons, a speaker grille.
  blob(v, ellipsePts(px, foot - h + w / 2 + 6, w / 2 - 22, w / 2 - 34), { fill: "#1a1418", seed: 5301, line: 1.8 });
  for (let i = 0; i < 8; i++) {
    v.rect(px - w / 2 + 18 + i * ((w - 36) / 8), foot - h * 0.42, (w - 36) / 8 - 3, 10, { fill: "#f0e8d0", stroke: INK, weight: 0.8 });
  }
  blob(v, roundRectPts(px - w / 2 + 16, foot - h * 0.34, w - 32, h * 0.28, 8), { fill: "#c8a868", seed: 5302, line: 1.8 });
  for (let i = 0; i < 6; i++) stroke(v, [[px - w / 2 + 22, foot - h * 0.32 + i * 7], [px + w / 2 - 22, foot - h * 0.32 + i * 7]], { seed: 5303 + i, weight: 1.6, colour: "#6a4a2a", amp: 0.3 });
  v.text("NOW PLAYING", { x: px, y: foot - h * 0.5 }, { size: 7, fill: "#f8e8c0", align: "center", valign: "middle", style: "bold" });
  v.text("MANDATORY FUN", { x: px, y: foot - h * 0.5 + 9 }, { size: 6, fill: "#f8e8c0", align: "center", valign: "middle" });
  v.text("(UPBEAT MIX)", { x: px, y: foot - h * 0.5 + 17 }, { size: 6, fill: "#f8e8c0", align: "center", valign: "middle" });
}
function jukeboxLive(v: View, t: number): void {
  const [px, foot] = at(JUKEBOX.x, 0, JUKEBOX.depth);
  const w = m(JUKEBOX.w), h = m(JUKEBOX.h);
  // Bubble tubes up both sides of the arch, cycling colour.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 9; k++) {
      const u = k / 8;
      const a = Math.PI / 2 - side * u * Math.PI * 0.5;
      const r = w / 2 - 9;
      const x = u < 0.5 ? px + side * (w / 2 - 9) : px + Math.cos(a) * r;
      const y = u < 0.5 ? foot - h * 0.38 - u * 2 * (h * 0.62 - w / 2) : foot - h + w / 2 - Math.sin(a) * r * ((u - 0.5) * 2);
      v.circle(x, y, 5, { fill: hueHex((t * 4 + k * 30 + (side > 0 ? 180 : 0)) % 360, 0.9, 0.6) });
    }
  }
  // The record.
  const rx = px, ry = foot - h + w / 2 + 6;
  v.ellipse(rx, ry, 26, 9, { fill: "#0a0a0c" });
  const a = t * 0.3;
  v.line(rx + Math.cos(a) * 20, ry + Math.sin(a) * 7, rx + Math.cos(a) * 24, ry + Math.sin(a) * 8, { stroke: "#6a6a70", weight: 1.4 });
  v.ellipse(rx, ry, 7, 3, { fill: "#d8402a" });
  glow(v, px, foot - h * 0.55, { rx: w, ry: h * 0.6, colour: hueHex((t * 4) % 360, 0.8, 0.6), alpha: 0.18 });
  notes(v, px, foot - h + 10, t, { colour: "#fff0b0", seed: 5320, n: 5, rise: 130 });
}

function tables(v: View): void {
  for (const [i, x] of TABLES.entries()) {
    const [px, py] = at(x, 0, TABLE_DEPTH);
    // Tape on the floor marking exactly where each table belongs.
    stroke(v, [[px - 70, py + 10], [px + 70, py + 10]], { seed: 5400 + i, weight: 3, colour: "rgba(240,220,90,0.75)", amp: 0.4 });
    for (const dx of [-70, 70]) stroke(v, [[px + dx, py + 10], [px + dx + (dx > 0 ? -2 : 2), py - 2]], { seed: 5401 + i + dx, weight: 3, colour: "rgba(240,220,90,0.75)", amp: 0.2 });
    v.text(`T${(i + 1).toString()}`, { x: px + 56, y: py + 4 }, { size: 7, fill: "rgba(240,220,90,0.9)", align: "center", valign: "middle", style: "bold" });
    shellChair(v, x - 0.55, TABLE_DEPTH - 0.05, { colour: ["#e8783a", "#e8c84a", "#3ab8c8"][i] ?? "#e8783a", facing: 1, seed: 5410 + i * 3 });
    shellChair(v, x + 0.55, TABLE_DEPTH - 0.05, { colour: ["#3ab8c8", "#e8783a", "#e8c84a"][i] ?? "#e8783a", facing: -1, seed: 5420 + i * 3 });
    tulipTable(v, x, TABLE_DEPTH, { w: 0.8, colour: "#f4f0e4", seed: 5430 + i * 3 });
    // A vase with one plastic flower, a napkin holder; set the same on every table.
    const top = py - m(0.72) - 8;
    blob(v, [[px - 18, top], [px - 8, top], [px - 9, top - 18], [px - 17, top - 18]], { fill: "#3ab8c8", seed: 5440 + i, line: 1.4 });
    stroke(v, [[px - 13, top - 18], [px - 12, top - 38]], { seed: 5441 + i, weight: 1.6, colour: "#3a8a3a" });
    for (let k = 0; k < 5; k++) v.circle(px - 12 + Math.cos(k * 1.26) * 5, top - 40 + Math.sin(k * 1.26) * 5, 3.4, { fill: "#f8f0f0", stroke: INK, weight: 0.8 });
    v.circle(px - 12, top - 40, 2.6, { fill: "#f8c840" });
    blob(v, [[px + 6, top], [px + 22, top], [px + 22, top - 14], [px + 6, top - 14]], { fill: "#c8c8cc", seed: 5445 + i, line: 1.2 });
    v.rect(px + 9, top - 18, 10, 6, { fill: "#f8f8f0" });
  }
}

function wallPieces(v: View): void {
  flowerStatic(v);
  hatch(v);
  b3(v);
  amaSpeaker(v, 8.25, 2.45);
  const [sx, sy] = at(6.35, 2.55, 0);
  signBox(v, sx, sy, 150, 24, "JOYOUS CAFE", { seed: 5500, face: "#f8e070", ink: "#a8341a", size: 14 });
}
function furniture(v: View): void {
  jukebox(v);
  tables(v);
}

function live(v: View, t: number): void {
  flowerLive(v, t);
  b3Bubbles(v, t);
  jukeboxLive(v, t);
  const [sx, sy] = at(6.35, 2.55, 0);
  glow(v, sx, sy, { rx: 110, ry: 34, colour: "#ffd860", alpha: 0.35 });
  amaEye(v, 8.25, 2.45, t);
  // A diner at table two, eating paste with great enthusiasm; a waiter doing rounds.
  const bob = Math.sin(t * 0.25) > 0.6 ? -2 : 0;
  v.at({ translate: [0, bob] }, () => citizen(v, { x: TABLES[1] - 0.6, depth: TABLE_DEPTH + 0.02, facing: 1, pose: "sit", suit: "#c89a3a", collar: "#eab308", hair: "#5a2a1a", skin: "#a87050" }, t));
  const w = pacing(t + 200, 0.9, 7.6, 0.011);
  citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#e8e0d0", collar: "#eab308", hair: "#2a1a10" }, t);
  // The waiter's tray.
  const [wx, wy] = at(w.x, 1.05, 2.6);
  blob(v, ellipsePts(wx + w.facing * 22, wy, 18, 4), { fill: "#c8c8cc", seed: 5600, line: 1.4 });
  v.circle(wx + w.facing * 18, wy - 7, 5, { fill: "#d8402a", stroke: INK, weight: 1 });
}

export const JOYOUS_CAFE: RoomSpec = {
  id: "joyous-cafe",
  name: "Joyous Cafe",
  width: 8.8,
  wall: "#eab308",
  trim: "#8a4a1a",
  sky: "clouds",
  floor: "tiles",
  floorColour: "#a8784a",
  ambient: "#c8bca8",
  exits: [
    { to: "Activity Hub", kind: "edge-left", label: "Activity Hub", glow: "#06b6d4" },
    { to: "Tranquil Pool", kind: "door", x: 7.3, style: "slide", label: "Tranquil Pool", glow: "#ec4899" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
  rim: { x: m(6.35), y: 480, colour: "#ffd890", reach: 360 },
};
