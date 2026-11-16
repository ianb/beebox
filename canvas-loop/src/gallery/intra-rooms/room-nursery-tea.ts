// Nursery. From intra-game: "Nursery: brightly decorated, neatly arranged toys, cribs and colourful murals, everything in perfect condition as if waiting for use (there are no children in Intra). Ceiling: balloons and confetti, a perpetual birthday."
// Exits (1): Quiet Plaza (edge-left).
//
// A fresh mural of four smiling, eyeless children holding hands; two made cribs
// with a teddy each; a mobile that turns over an empty crib; a rocket rocking
// horse that rocks by itself; blocks spelling AMA; a counter of days the room
// has been ready; a framed certificate of baby's first clearance.
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { frame, slab, stencil } from "./parts-c-tea.js";
import { amaEye, amaSpeaker, citizen } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const CEIL = 3.0;

function mural(v: View): void {
  const [x0, yb] = at(0.95, 1.15, 0), [x1, yt] = at(4.75, 2.75, 0);
  // Fresh paint over the old wall: a sky-blue panel with a soft edge.
  blob(v, [[x0, yb], [x1, yb], [x1, yt], [x0, yt]], { fill: "#9ad8f0", light: "#c0ecff", seed: 3000, line: 0.8, amp: 3 });
  // Rainbow.
  const cx = (x0 + x1) / 2, cy = yb + 10;
  for (const [i, c] of ["#e84a4a", "#f8a83a", "#f8e04a", "#5ac85a", "#4a8ae8", "#9a5ae8"].entries()) v.arc(cx, cy, 190 - i * 12, Math.PI, Math.PI * 2, { stroke: c, weight: 12 });
  // The sun, smiling.
  const [sx, sy] = [x1 - 60, yt + 50];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    v.line(sx + Math.cos(a) * 30, sy + Math.sin(a) * 30, sx + Math.cos(a) * 42, sy + Math.sin(a) * 42, { stroke: "#f8c83a", weight: 5 });
  }
  blob(v, ellipsePts(sx, sy, 26, 26), { fill: "#f8d84a", light: "#fff0a0", seed: 3001, line: 2 });
  v.circle(sx - 8, sy - 5, 2.5, { fill: "#3a2a10" });
  v.circle(sx + 8, sy - 5, 2.5, { fill: "#3a2a10" });
  v.arc(sx, sy + 2, 12, 0.3, Math.PI - 0.3, { stroke: "#3a2a10", weight: 2 });
  // A rocket with a face.
  v.at({ translate: [x0 + 70, yt + 70], rotate: 0.5 }, () => {
    blob(v, [[-14, 30], [14, 30], [14, -20], [0, -44], [-14, -20]], { fill: "#f0f0f0", light: "#ffffff", seed: 3002, line: 2 });
    blob(v, [[-14, 30], [-26, 42], [-14, 12]], { fill: "#e84a4a", seed: 3003, line: 1.6 });
    blob(v, [[14, 30], [26, 42], [14, 12]], { fill: "#e84a4a", seed: 3004, line: 1.6 });
    blob(v, ellipsePts(0, -8, 7, 7), { fill: "#4a8ae8", seed: 3005, line: 1.6 });
    blob(v, [[-8, 32], [8, 32], [0, 52]], { fill: "#f8a83a", seed: 3006, line: 1.4 });
  });
  // Four children holding hands, numbered, smiling, with no eyes.
  const suits = ["#e84a4a", "#f8a83a", "#5ac85a", "#4a8ae8"];
  const ky = yb - 4;
  for (const [i, c] of suits.entries()) {
    const kx = x0 + 120 + i * 92;
    blob(v, [[kx - 16, ky], [kx - 4, ky], [kx - 2, ky - 40], [kx + 2, ky - 40], [kx + 4, ky], [kx + 16, ky], [kx + 14, ky - 74], [kx - 14, ky - 74]], { fill: c, light: mixHex(c, "#ffffff", 0.3), seed: 3010 + i, line: 2 });
    blob(v, ellipsePts(kx, ky - 92, 17, 18), { fill: "#f8d8b0", seed: 3020 + i, line: 2 });
    v.arc(kx, ky - 90, 9, 0.25, Math.PI - 0.25, { stroke: "#3a2010", weight: 2 });
    v.text(`00${i + 1}`, { x: kx, y: ky - 56 }, { size: 9, fill: "#ffffff", align: "center", valign: "middle", style: "bold" });
    if (i < 3) stroke(v, [[kx + 14, ky - 66], [kx + 46, ky - 56], [kx + 78, ky - 66]], { seed: 3030 + i, weight: 3, colour: "#f8d8b0", amp: 0.4 });
  }
}

/** A white crib, as new, its mattress made, a teddy sitting up in it. */
function crib(v: View, x: number, depth: number, a: { blanket: string; seed: number }): void {
  const [px, py] = at(x, 0, depth);
  const hw = m(0.62), s = a.seed;
  const top = py - m(0.98), mat = py - m(0.5);
  for (const lx of [px - hw, px + hw - 10]) blob(v, [[lx, py - 6], [lx + 10, py - 6], [lx + 10, top - 14], [lx, top - 14]], { fill: "#f4f0e8", dark: "#b8b0a0", seed: s + lx, line: 2 });
  for (const lx of [px - hw + 5, px + hw - 5]) blob(v, ellipsePts(lx, py - 4, 6, 6), { fill: "#c8c0b0", seed: s + 3 + lx, line: 1.4 });
  slab(v, { x0: x - 0.6, x1: x + 0.6, h0: 0.36, h1: 0.5, depth }, { fill: "#e8f0f8", seed: s + 5 });
  blob(v, roundRectPts(px - hw + 30, mat - 18, 2 * hw - 90, 20, 6), { fill: a.blanket, light: mixHex(a.blanket, "#ffffff", 0.4), seed: s + 6, line: 1.8 });
  blob(v, roundRectPts(px + hw - 58, mat - 16, 40, 16, 7), { fill: "#ffffff", seed: s + 7, line: 1.6 });
  // Teddy.
  const tx = px - hw + 50;
  blob(v, ellipsePts(tx, mat - 22, 17, 20), { fill: "#b07a4a", light: "#d09a6a", seed: s + 8, line: 1.8 });
  for (const ex of [-11, 11]) blob(v, ellipsePts(tx + ex, mat - 60, 6, 6), { fill: "#b07a4a", seed: s + 9 + ex, line: 1.4 });
  blob(v, ellipsePts(tx, mat - 50, 13, 12), { fill: "#b07a4a", light: "#d09a6a", seed: s + 30, line: 1.8 });
  v.circle(tx - 5, mat - 52, 1.8, { fill: "#1a1010" });
  v.circle(tx + 5, mat - 52, 1.8, { fill: "#1a1010" });
  blob(v, roundRectPts(tx - 4, mat - 34, 8, 4, 2), { fill: a.blanket, seed: s + 31, line: 0.8 });
  // Rails and slats.
  for (let sx = px - hw + 18; sx < px + hw - 12; sx += 22) v.line(sx, mat - 4, sx, top, { stroke: "#f4f0e8", weight: 3.5 });
  for (let sx = px - hw + 18; sx < px + hw - 12; sx += 22) stroke(v, [[sx - 2, mat - 4], [sx - 2.5, top]], { seed: s + sx, weight: 0.8, amp: 0.3 });
  blob(v, roundRectPts(px - hw, top - 6, 2 * hw, 10, 4), { fill: "#f4f0e8", dark: "#b8b0a0", seed: s + 40, line: 1.8 });
}

/** Wooden blocks, neatly stacked. */
function blocks(v: View, x: number, depth: number): void {
  const [px, py] = at(x, 0, depth);
  const b = m(0.2);
  const row = [["A", "#e84a4a"], ["M", "#f8c83a"], ["A", "#4a8ae8"]] as const;
  for (const [i, [l, c]] of row.entries()) {
    const bx = px - 1.5 * b + i * b;
    blob(v, [[bx, py], [bx + b - 2, py], [bx + b - 2, py - b], [bx, py - b]], { fill: c, light: mixHex(c, "#ffffff", 0.3), seed: 3100 + i, line: 1.8, amp: 0.4 });
    v.text(l, { x: bx + b / 2 - 1, y: py - b / 2 }, { size: 18, fill: "#ffffff", align: "center", valign: "middle", style: "bold" });
  }
  const tx = px - b / 2;
  blob(v, [[tx, py - b], [tx + b - 2, py - b], [tx + b - 2, py - 2 * b], [tx, py - 2 * b]], { fill: "#5ac85a", light: "#8ae88a", seed: 3110, line: 1.8, amp: 0.4 });
  v.text("1", { x: tx + b / 2 - 1, y: py - 1.5 * b }, { size: 18, fill: "#ffffff", align: "center", valign: "middle", style: "bold" });
}

/** The rocket rocking horse, drawn about the middle of its rockers. */
const HORSE: [number, number] = [5.95, 1.5];
function rockingRocket(v: View, rock: number): void {
  const [px, py] = at(HORSE[0], 0, HORSE[1]);
  v.at({ translate: [px, py], rotate: rock }, () => {
    const rk: Vec2[] = Array.from({ length: 9 }, (_, i): Vec2 => [-64 + i * 16, -Math.cos(((i - 4) / 4) * 1.1) * 10 + 4]);
    stroke(v, rk, { seed: 3200, weight: 6, colour: "#e84a4a" });
    for (const lx of [-34, 30]) stroke(v, [[lx, -6], [lx + (lx < 0 ? 8 : -8), -48]], { seed: 3201 + lx, weight: 4, colour: "#c8ccd0" });
    blob(v, [[-60, -50], [40, -50], [62, -62], [40, -76], [-60, -76], [-70, -63]], { fill: "#f0f0f0", light: "#ffffff", dark: "#b0b0b8", seed: 3203, line: 2.2 });
    blob(v, [[-60, -76], [-78, -96], [-70, -63]], { fill: "#e84a4a", seed: 3204, line: 1.6 });
    blob(v, ellipsePts(30, -63, 8, 8), { fill: "#4a8ae8", seed: 3205, line: 1.4 });
    blob(v, roundRectPts(-24, -86, 34, 12, 4), { fill: "#f8c83a", seed: 3206, line: 1.6 });
    v.text("JUNIOR", { x: -14, y: -63 }, { size: 9, fill: "#e84a4a", align: "center", valign: "middle", style: "bold" });
  });
}

/** The mobile over the first crib: four shapes on a turning cross. */
const MOBILE: [number, number, number] = [2.05, 1.62, 0.7];
function mobile(v: View, t: number): void {
  const [mx, my] = at(MOBILE[0], MOBILE[1], MOBILE[2]);
  const [, top] = at(MOBILE[0], CEIL, 0);
  stroke(v, [[mx, top], [mx, my]], { seed: 3300, weight: 1.2, amp: 0.2 });
  const a0 = t * 0.025;
  const items = [0, 1, 2, 3].map((k) => ({ k, a: a0 + (k * Math.PI) / 2 })).toSorted((p, q) => Math.sin(p.a) - Math.sin(q.a));
  v.line(mx - Math.cos(a0) * 60, my, mx + Math.cos(a0) * 60, my, { stroke: "#c8a870", weight: 2 });
  v.line(mx - Math.sin(a0) * 60, my, mx + Math.sin(a0) * 60, my, { stroke: "#c8a870", weight: 2 });
  for (const { k, a } of items) {
    const ix = mx + Math.cos(a) * 60, iy = my + 34 + k * 4;
    v.line(ix, my, ix, iy - 10, { stroke: "rgba(40,30,20,0.6)", weight: 0.8 });
    const near = 0.75 + 0.25 * Math.sin(a);
    const c = ["#f8c83a", "#e84a4a", "#4a8ae8", "#5ac85a"][k] ?? "#fff";
    if (k === 0) blob(v, Array.from({ length: 10 }, (_, i): Vec2 => [ix + Math.cos((i / 10) * Math.PI * 2) * (i % 2 === 0 ? 12 : 5) * near, iy + Math.sin((i / 10) * Math.PI * 2) * (i % 2 === 0 ? 12 : 5)]), { fill: c, seed: 3310, line: 1.2, amp: 0.2 });
    else if (k === 1) blob(v, [[ix - 6 * near, iy + 10], [ix + 6 * near, iy + 10], [ix, iy - 12]], { fill: c, seed: 3311, line: 1.2, amp: 0.2 });
    else if (k === 2) blob(v, ellipsePts(ix, iy, 10 * near, 10), { fill: c, seed: 3312, line: 1.2, amp: 0.2 });
    else {
      blob(v, ellipsePts(ix, iy, 9 * near, 9), { fill: c, seed: 3313, line: 1.2, amp: 0.2 });
      v.ellipse(ix, iy, 16 * near, 4, { stroke: "#2a2018", weight: 1.2 });
    }
  }
}

function wallPieces(v: View): void {
  mural(v);
  // How long the room has been ready (the number is drawn per frame).
  const [cx, cy] = at(5.55, 1.95, 0);
  blob(v, roundRectPts(cx - 70, cy - 40, 140, 80, 8), { fill: "#f8f0e0", light: "#ffffff", seed: 3400, line: 2 });
  v.text("THIS NURSERY HAS", { x: cx, y: cy - 28 }, { size: 8, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" });
  v.text("BEEN READY FOR", { x: cx, y: cy - 18 }, { size: 8, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" });
  v.text("DAYS", { x: cx, y: cy + 28 }, { size: 8, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" });
  frame(v, { x: 6.55, h: 1.6, w: 0.42, hh: 0.32, seed: 3410, colour: "#c8a040" }, (w, h) => {
    v.text("BABY'S FIRST", { x: 0, y: -h * 0.32 }, { size: 7, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" });
    v.text("CLEARANCE", { x: 0, y: -h * 0.12 }, { size: 7, fill: "#3a2a40", align: "center", valign: "middle", style: "bold" });
    v.text("INFRARED", { x: 0, y: h * 0.12 }, { size: 9, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
    v.line(-w * 0.3, h * 0.34, w * 0.1, h * 0.34, { stroke: "#3a2a40", weight: 0.8 });
    blob(v, ellipsePts(w * 0.3, h * 0.3, 7, 7), { fill: "#e8b83a", seed: 3411, line: 1 });
  });
  // A tiny jumpsuit on a peg, numbered 000.
  const [jx, jy] = at(6.6, 1.15, 0);
  v.circle(jx, jy - 40, 3, { fill: "#8a8a8e" });
  blob(v, [[jx - 16, jy - 36], [jx + 16, jy - 36], [jx + 20, jy - 20], [jx + 12, jy - 20], [jx + 12, jy + 20], [jx + 2, jy + 20], [jx, jy], [jx - 2, jy + 20], [jx - 12, jy + 20], [jx - 12, jy - 20], [jx - 20, jy - 20]], { fill: "#4a8ac8", light: "#7ab0e8", seed: 3420, line: 1.6 });
  blob(v, [[jx - 7, jy - 36], [jx + 7, jy - 36], [jx + 4, jy - 31], [jx - 4, jy - 31]], { fill: "#a855f7", seed: 3421, line: 1 });
  stencil(v, "000", { x: jx, y: jy - 22 }, { size: 7, colour: "#ffffff" });
  amaSpeaker(v, 6.8, 2.6);
  // A shelf of soft toys, all facing the door.
  const [sx0, sy] = at(0.45, 1.85, 0);
  blob(v, roundRectPts(sx0 - 6, sy, m(0.5) + 12, 8, 2), { fill: "#f4f0e8", seed: 3430, line: 1.6 });
  for (let i = 0; i < 3; i++) {
    const bx = sx0 + 14 + i * 24, c = ["#f8a8c8", "#a8d8f8", "#f8e8a8"][i] ?? "#fff";
    blob(v, ellipsePts(bx, sy - 10, 10, 11), { fill: c, seed: 3431 + i, line: 1.4 });
    blob(v, ellipsePts(bx, sy - 27, 8, 8), { fill: c, seed: 3435 + i, line: 1.4 });
    v.circle(bx - 3, sy - 28, 1.2, { fill: "#1a1010" });
    v.circle(bx + 3, sy - 28, 1.2, { fill: "#1a1010" });
  }
}

function furniture(v: View): void {
  crib(v, 2.05, 0.7, { blanket: "#a8d0f8", seed: 3500 });
  crib(v, 3.75, 0.7, { blanket: "#f8b8d0", seed: 3600 });
  // A rug: a big sun, very clean.
  const [rx, ry] = at(4.5, 0, 1.6);
  blob(v, ellipsePts(rx, ry, m(1.3), 20, 26), { fill: "#f8d860", light: "#fff0a0", seed: 3700, line: 1.6 });
  blob(v, ellipsePts(rx, ry, m(0.8), 12, 22), { fill: "#f8a83a", seed: 3701, line: 1.2 });
  blocks(v, 4.85, 1.35);
  // A ball, perfectly round, never kicked.
  const [bx, by] = at(1.0, 0, 1.9);
  blob(v, ellipsePts(bx, by - 18, 18, 18), { fill: "#e84a4a", light: "#ff8a8a", seed: 3710, line: 2 });
  v.arc(bx, by - 18, 18, -1.2, 1.2, { stroke: "#ffffff", weight: 4 });
  // A pram, parked, empty.
  const [cx, cy] = at(6.75, 0, 1.0);
  for (const wx of [cx - 26, cx + 22]) {
    v.circle(wx, cy - 14, 13, { fill: "#f4f0e8" });
    v.circle(wx, cy - 14, 13, { stroke: "#2a2018", weight: 2 });
  }
  blob(v, [[cx - 44, cy - 34], [cx + 40, cy - 34], [cx + 34, cy - 70], [cx - 40, cy - 70]], { fill: "#a855f7", light: "#c88aff", seed: 3720, line: 2 });
  blob(v, [[cx + 10, cy - 70], [cx + 40, cy - 70], [cx + 44, cy - 104], [cx + 14, cy - 96]], { fill: "#8a3ad8", seed: 3721, line: 2 });
  stroke(v, [[cx - 40, cy - 66], [cx - 64, cy - 92]], { seed: 3722, weight: 3, colour: "#c8ccd0" });
}

export const NURSERY: RoomSpec = {
  id: "nursery",
  name: "Nursery",
  width: 7.2,
  wall: "#a855f7",
  trim: "#f8c83a",
  sky: "balloons",
  floor: "carpet",
  floorColour: "#c88ab8",
  ambient: "#c0b0d0",
  exits: [
    { to: "Quiet Plaza", kind: "edge-left", label: "Quiet Plaza", glow: "#a855f7" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live: (v, t) => {
    // Warm night-light by the cribs.
    const [gx, gy] = at(2.9, 0.8, 0.7);
    glow(v, gx, gy, { rx: 260, ry: 160, colour: "#ffd8a0", alpha: 0.22 + 0.04 * Math.sin(t * 0.05) });
    mobile(v, t);
    rockingRocket(v, Math.sin(t * 0.07) * 0.12);
    const [cx, cy] = at(5.55, 1.95, 0);
    const days = 11893 + Math.floor(t / 20);
    v.text(`${Math.floor(days / 1000)},${String(days % 1000).padStart(3, "0")}`, { x: cx, y: cy + 5 }, { size: 20, fill: "#d02a6a", align: "center", valign: "middle", style: "bold", font: "Courier New, monospace" });
    amaEye(v, 6.8, 2.6, t);
    // The attendant waits by the cribs, very still, smiling at no one.
    citizen(v, { x: 3.0, depth: 1.9, facing: -1, pose: "stand", suit: "#f0e8f0", collar: "#a855f7", number: "02", skin: "#e8b898", hair: "#c8a050" }, t);
  },
};
