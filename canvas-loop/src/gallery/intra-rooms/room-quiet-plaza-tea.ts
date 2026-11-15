// Quiet Plaza. From intra-game: "Quiet Plaza: a small plaza with benches and old non-functional fountains. Running water plays through hidden speakers, no visible source. Ceiling: starry night, constellations scattered and sometimes shifting."
// Exits (3): Feedback Booth (edge-left), Nursery (edge-right), Ill-Fitting Lounge (stairs-up).
//
// A dry tiered fountain topped with a chrome atom, its basin heaped with bottle
// caps; a dry wall fountain with a smiling mask; a fake rock that is the water's
// only source (a speaker); a plaque naming tonight's constellations.
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { stencil } from "./parts-c-tea.js";
import { amaEye, amaSpeaker, bench, citizen, pacing, plant, poster } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const STONE = "#b8ac9c";

/** The dry tiered fountain, out in the plaza: basin, pedestal, upper bowl, a chrome atom on top. */
function fountain(v: View, x: number, depth: number): void {
  const [px, py] = at(x, 0, depth);
  const bw = m(0.8);
  // Basin with a rolled lip.
  blob(v, [[px - bw + 10, py], [px + bw - 10, py], [px + bw, py - m(0.38)], [px - bw, py - m(0.38)]], { fill: STONE, light: "#d8ccb8", dark: "#7a6e60", seed: 2000, line: 2.4, shadeSide: "right" });
  blob(v, roundRectPts(px - bw - 8, py - m(0.46), bw * 2 + 16, m(0.09), 6), { fill: mixHex(STONE, "#ffffff", 0.1), dark: "#7a6e60", seed: 2010, line: 2.2 });
  // Bottle caps heaped over the lip, and a few that spilled.
  for (let i = 0; i < 44; i++) {
    const u = hash(i, 0, 2001), cx = px - bw * 0.8 + u * bw * 1.6, cy = py - m(0.48) - Math.sin(u * Math.PI) * 22 * hash(i, 3, 2004) + 4;
    const c = ["#c83a2a", "#3a6ac8", "#d8b03a", "#e8e0d0", "#2a8a5a"][i % 5] ?? "#c83a2a";
    blob(v, ellipsePts(cx, cy, 6, 3.5, 8), { fill: c, seed: 2003 + i, line: 1, amp: 0.3 });
  }
  for (let i = 0; i < 4; i++) blob(v, ellipsePts(px - bw - 20 + i * 70 + hash(i, 0, 2030) * 30, py + 6 + i * 2, 5, 2.5, 8), { fill: i % 2 === 0 ? "#c83a2a" : "#d8b03a", seed: 2031 + i, line: 1, amp: 0.2 });
  // A crack, taped.
  stroke(v, [[px + 30, py - m(0.36)], [px + 40, py - m(0.25)], [px + 34, py - m(0.14)], [px + 46, py - 4]], { seed: 2011, weight: 1.4 });
  v.at({ translate: [px + 38, py - m(0.22)], rotate: 0.4 }, () => v.rect(-12, -4, 24, 8, { fill: "rgba(230,220,180,0.85)" }));
  // Pedestal, upper bowl, finial.
  blob(v, [[px - 16, py - m(0.46)], [px + 16, py - m(0.46)], [px + 11, py - m(1.0)], [px - 11, py - m(1.0)]], { fill: STONE, light: "#d8ccb8", dark: "#7a6e60", seed: 2012, line: 2.2, shadeSide: "right" });
  const ub = m(0.42);
  blob(v, [[px - 14, py - m(0.98)], [px + 14, py - m(0.98)], [px + ub, py - m(1.16)], [px + ub + 4, py - m(1.22)], [px - ub - 4, py - m(1.22)], [px - ub, py - m(1.16)]], { fill: STONE, light: "#d8ccb8", dark: "#7a6e60", seed: 2013, line: 2.2 });
  // Old water stains and limescale where the water used to spill.
  for (const dx of [-ub + 6, -ub * 0.4, ub * 0.5, ub - 6]) stroke(v, [[px + dx, py - m(1.16)], [px + dx * 0.9, py - m(0.5)]], { seed: 2014 + dx, weight: 5, colour: "rgba(60,80,70,0.35)", amp: 1.4 });
  stroke(v, [[px, py - m(1.22)], [px, py - m(1.36)]], { seed: 2020, weight: 4, colour: "#8a8e94" });
  // The atom: a chrome ball with three orbits, one bent.
  const [ax, ay] = [px, py - m(1.46)];
  blob(v, ellipsePts(ax, ay, 11, 11), { fill: "#c8ccd0", light: "#ffffff", dark: "#6a6e74", seed: 2021, line: 1.8 });
  for (let k = 0; k < 3; k++) v.at({ translate: [ax, ay], rotate: (k * Math.PI) / 3 + (k === 2 ? 0.25 : 0) }, () => v.ellipse(0, 0, 30, 9, { stroke: "#4a4e54", weight: 1.8 }));
  // A sign hung on the pedestal.
  v.at({ translate: [px, py - m(0.72)], rotate: -0.06 }, () => {
    blob(v, roundRectPts(-34, -11, 68, 22, 3), { fill: "#e8dcc0", seed: 2022, line: 1.4, amp: 0.4 });
    v.text("NO WISHING", { x: 0, y: 0 }, { size: 8, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  });
}

/** A dry wall fountain: a smiling sun mask over a shell basin, a green streak below its mouth. */
function wallFountain(v: View, x: number): void {
  const [cx, cy] = at(x, 1.35, 0);
  const [, by] = at(x, 0.8, 0);
  stroke(v, [[cx, cy + 14], [cx + 2, by - 6]], { seed: 2100, weight: 12, colour: "rgba(60,110,70,0.5)", amp: 1.2 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    blob(v, [[cx + Math.cos(a - 0.15) * 30, cy + Math.sin(a - 0.15) * 30], [cx + Math.cos(a) * 46, cy + Math.sin(a) * 46], [cx + Math.cos(a + 0.15) * 30, cy + Math.sin(a + 0.15) * 30]], { fill: "#c8a050", seed: 2101 + k, line: 1.4, amp: 0.3 });
  }
  blob(v, ellipsePts(cx, cy, 32, 32), { fill: "#d8b060", light: "#f0d080", dark: "#8a6a30", seed: 2115, line: 2.2 });
  v.arc(cx - 11, cy - 6, 5, Math.PI + 0.3, -0.3, { stroke: "#3a2a10", weight: 2 });
  v.arc(cx + 11, cy - 6, 5, Math.PI + 0.3, -0.3, { stroke: "#3a2a10", weight: 2 });
  blob(v, ellipsePts(cx, cy + 12, 7, 5), { fill: "#2a1a10", seed: 2116, line: 1.4 });
  // The shell basin.
  blob(v, [[cx - 50, by - 4], [cx + 50, by - 4], [cx + 40, by + 18], [cx, by + 26], [cx - 40, by + 18]], { fill: STONE, light: "#d8ccb8", dark: "#7a6e60", seed: 2117, line: 2.2, shadeSide: "bottom" });
  for (let k = -2; k <= 2; k++) stroke(v, [[cx + k * 16, by - 2], [cx + k * 10, by + 20]], { seed: 2118 + k, weight: 1, amp: 0.4 });
  const [lx, ly] = at(x, 0.62, 0);
  blob(v, roundRectPts(lx - 62, ly - 13, 124, 26, 3), { fill: "#e8dcc0", seed: 2125, line: 1.4, amp: 0.4 });
  v.text("DRINKING WATER", { x: lx, y: ly - 5 }, { size: 8, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
  v.text("now decorative", { x: lx, y: ly + 6 }, { size: 7, fill: "#8a1a1a", align: "center", valign: "middle", style: "italic" });
}

/** The fake rock in a planter that the water sound comes from. */
const ROCK: [number, number] = [3.95, 0.55];
function speakerRock(v: View): void {
  const [x, depth] = ROCK;
  const [px, py] = at(x, 0, depth);
  blob(v, [[px - 46, py], [px + 46, py], [px + 50, py - 34], [px - 50, py - 34]], { fill: "#6a5a4a", light: "#8a7660", dark: "#3a2e24", seed: 2200, line: 2.2 });
  for (let i = 0; i < 5; i++) stroke(v, [[px - 40 + i * 20, py - 34], [px - 44 + i * 20 + hash(i, 0, 2201) * 8, py - 50 - hash(i, 1, 2202) * 10]], { seed: 2203 + i, weight: 3, colour: "#4a8a3a", amp: 0.6 });
  blob(v, [[px - 30, py - 34], [px + 32, py - 34], [px + 26, py - 70], [px + 4, py - 84], [px - 22, py - 72]], { fill: "#8a8478", light: "#aaa496", dark: "#5a564e", seed: 2210, line: 2.2, shadeSide: "right" });
  // The grille shows through a chip in the "rock".
  blob(v, ellipsePts(px + 4, py - 58, 12, 9), { fill: "#2a2a2e", seed: 2211, line: 1.4 });
  for (let k = -2; k <= 2; k++) v.line(px - 6, py - 58 + k * 3, px + 14, py - 58 + k * 3, { stroke: "#6a6a70", weight: 1 });
  v.text("AQUA-SOUND MK II", { x: px, y: py - 18 }, { size: 6, fill: "#d8ccb0", align: "center", valign: "middle" });
}

/** A low mushroom bollard lamp: 70s path lighting. */
function bollard(v: View, x: number, depth: number): void {
  const [px, py] = at(x, 0, depth);
  blob(v, [[px - 8, py], [px + 8, py], [px + 6, py - m(0.45)], [px - 6, py - m(0.45)]], { fill: "#5a4a6a", seed: 2300 + x, line: 1.8 });
  blob(v, [[px - 26, py - m(0.45)], [px + 26, py - m(0.45)], [px + 14, py - m(0.58)], [px - 14, py - m(0.58)]], { fill: "#e8b84a", light: "#ffe08a", seed: 2301 + x, line: 1.8 });
}

/** Tonight's constellations, as the plaque names them. */
function plaque(v: View, x: number): void {
  const [cx, cy] = at(x, 1.75, 0);
  blob(v, roundRectPts(cx - 74, cy - 46, 148, 92, 6), { fill: "#2a2440", light: "#3a3460", seed: 2400, line: 2 });
  v.text("CONSTELLATIONS", { x: cx, y: cy - 34 }, { size: 9, fill: "#e8d8a0", align: "center", valign: "middle", style: "bold" });
  v.text("TONIGHT", { x: cx, y: cy - 23 }, { size: 9, fill: "#e8d8a0", align: "center", valign: "middle", style: "bold" });
  const names = ["The Ladle", "The Compliant Citizen", "Ama Major", "The Other Ladle"];
  for (const [i, n] of names.entries()) v.text(n, { x: cx, y: cy - 6 + i * 11 }, { size: 8, fill: "#c8c0e0", align: "center", valign: "middle", style: "italic" });
  v.line(cx - 46, cy + 27, cx + 46, cy + 27, { stroke: "#c84a3a", weight: 1.4 });
}

function wallPieces(v: View): void {
  poster(v, 0.95, "calm", { h: 1.7 });
  plaque(v, 2.9);
  wallFountain(v, 7.75);
  amaSpeaker(v, 7.2, 2.2);
  // Paranoia: the plaza's own clearance.
  const [sx, sy] = at(4.05, 2.0, 0);
  blob(v, roundRectPts(sx - 50, sy - 15, 100, 30, 4), { fill: "#7a3ab8", seed: 2500, line: 1.6 });
  stencil(v, "QUIET IS A PRIVILEGE", { x: sx, y: sy - 5 }, { size: 7, colour: "#f0e0ff" });
  stencil(v, "CLEARANCE: VIOLET", { x: sx, y: sy + 6 }, { size: 7, colour: "#f8d848" });
}

function furniture(v: View): void {
  speakerRock(v);
  fountain(v, 2.9, 1.1);
  plant(v, 7.0, 0.7, { h: 0.65, leaf: "#8a5ac8", seed: 2600 });
  bench(v, 1.35, 1.6, { w: 1.5, colour: "#8a5ac0", seed: 2610 });
  bench(v, 7.6, 1.7, { w: 1.4, colour: "#8a5ac0", seed: 2620 });
  bollard(v, 0.5, 2.2);
  bollard(v, 5.0, 2.1);
  bollard(v, 8.3, 2.3);
}

/** The water sound: rings spreading from the rock, fading. */
function waterSound(v: View, t: number): void {
  const [px, py] = at(ROCK[0], 0, ROCK[1]);
  const cx = px + 4, cy = py - 58;
  for (let k = 0; k < 4; k++) {
    const u = ((t + k * 18) % 72) / 72;
    const r = 14 + u * 70;
    const a = (1 - u) * 0.55;
    v.arc(cx, cy, r, -Math.PI * 0.85, -Math.PI * 0.15, { stroke: `rgba(170,220,255,${a.toFixed(3)})`, weight: 2 });
  }
  // Little wavy marks: the sound of water drawn as water.
  for (let k = 0; k < 3; k++) {
    const u = ((t * 0.7 + k * 30) % 90) / 90;
    const wx = cx - 30 + k * 30, wy = cy - 20 - u * 60;
    const pts: Vec2[] = Array.from({ length: 6 }, (_, i): Vec2 => [wx + i * 4, wy + Math.sin(i * 1.6 + t * 0.2) * 2]);
    v.curve(pts, false, { stroke: `rgba(190,230,255,${((1 - u) * 0.7).toFixed(3)})`, weight: 1.6 });
  }
}

export const QUIET_PLAZA: RoomSpec = {
  id: "quiet-plaza",
  name: "Quiet Plaza",
  width: 8.8,
  wall: "#a855f7",
  trim: "#4a2a6a",
  sky: "shifting-stars",
  floor: "terrazzo",
  floorColour: "#8a8494",
  ambient: "#8a88b8",
  exits: [
    { to: "Feedback Booth", kind: "edge-left", label: "Feedback Booth", glow: "#6b7280" },
    { to: "Nursery", kind: "edge-right", label: "Nursery", glow: "#a855f7" },
    { to: "Ill-Fitting Lounge", kind: "stairs-up", x: 4.6, label: "Ill-Fitting Lounge", glow: "#22c55e" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live: (v, t) => {
    for (const [i, [x, d]] of ([[0.5, 2.2], [5.0, 2.1], [8.3, 2.3]] as const).entries()) {
      const [px, py] = at(x, 0.55, d);
      const flick = hash(Math.floor(t / 3), i, 2700) < 0.08 ? 0.3 : 1;
      glow(v, px, py + 20, { rx: 90, ry: 40, colour: "#ffc860", alpha: 0.4 * flick });
    }
    waterSound(v, t);
    amaEye(v, 7.2, 2.2, t);
    citizen(v, { x: 1.15, depth: 1.62, facing: 1, pose: "sit", suit: "#5a4a7a", collar: "#a855f7", number: "31", hair: "#8a8a8a" }, t);
    const w = pacing(t + 300, 0.4, 8.4, 0.008);
    citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#3a6a9a", collar: "#a855f7", number: "19", skin: "#e0b090", hair: "#6a3a1a" }, t);
  },
};
