// Activity Hub. From intra-game: "Activity Hub: an open room of mismatched exercise
// equipment, some broken, some for activities no one remembers. Citizens gather
// for 'extreme resting', competing to nap the longest. Sky: clear, birds sometimes
// fly backward or in loops."
// Exits (2): Hollow Atrium (edge-left), Joyous Cafe (edge-right).
import type { Vec2, View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { dial, signBox } from "./parts-a-tea.js";
import { amaEye, amaSpeaker, bunting, citizen, clock, pacing, poster, tubeGlow, tubeLight } from "./props-tea.js";
import { m } from "./sizes-tea.js";

const BELT = { x: 1.25, depth: 1.0 };
const OMNI = { x: 2.85, depth: 0.7 };
const BIKE = { x: 4.25, depth: 1.5 };
const BOARD = { x: 6.55, h: 2.05 };
/** The nappers on their mats: [x m, depth, suit, number, mask]. */
const NAPPERS = [[5.0, 1.45, "#5a7aaa", "31", true], [6.5, 1.95, "#c87a4a", "09", false]] as const;

// --- The jiggle belt: a column, a strap on a loop, shaking by itself. ----------------------

function beltColumn(v: View): void {
  const [px, foot] = at(BELT.x, 0, BELT.depth);
  blob(v, roundRectPts(px - m(0.3), foot - 16, m(0.6), 16, 5), { fill: "#5a5a5e", seed: 4000, line: 2 });
  blob(v, [[px - 18, foot - 14], [px + 18, foot - 14], [px + 14, foot - m(1.05)], [px - 14, foot - m(1.05)]], { fill: "#e8e0c8", light: "#ffffff", dark: "#8a8270", seed: 4001, line: 2.2, shadeSide: "right" });
  blob(v, roundRectPts(px - 24, foot - m(1.15), 48, 24, 8), { fill: "#c8642a", light: "#e88a4a", seed: 4002, line: 2 });
  v.text("TRIM-O-MATIC", { x: px, y: foot - m(0.6) }, { size: 7, fill: "#8a3a1a", align: "center", valign: "middle", style: "bold" });
  for (let i = 0; i < 2; i++) dial(v, px - 8 + i * 16, foot - m(0.82), 6, 0.9, 4003 + i);
}
function beltStrap(v: View, t: number): void {
  const [px, foot] = at(BELT.x, 0, BELT.depth);
  const y = foot - m(1.0), shake = Math.sin(t * 1.7) * 3;
  // The strap: a loop reaching out for a waist that is not there.
  const cx = px + 58 + shake;
  v.ellipse(cx, y + 2, 44, 13, { stroke: INK, weight: 9 });
  v.ellipse(cx, y + 2, 44, 13, { stroke: "#d8b85a", weight: 6 });
  v.line(px + 14, y - 4, cx - 40, y - 2, { stroke: "#d8b85a", weight: 5 });
  for (let i = 0; i < 3; i++) v.line(cx + 50 + i * 4, y - 8 + i * 7, cx + 58 + i * 4, y - 10 + i * 7, { stroke: "rgba(40,30,20,0.6)", weight: 1.4 });
}

// --- The Omni-Flex: equipment for an activity no one remembers. ---------------------------

function omniFrame(v: View): void {
  const [px, foot] = at(OMNI.x, 0, OMNI.depth);
  const steel = "#8a9aa8";
  // Base rail, an A-frame, a cross beam with a spring and a dangling handle.
  blob(v, roundRectPts(px - m(0.75), foot - 14, m(1.5), 14, 4), { fill: "#4a4a50", seed: 4100, line: 2 });
  for (const [a, b] of [[[-0.6, 0], [-0.3, 1.9]], [[0.0, 0], [-0.3, 1.9]], [[0.6, 0], [0.45, 1.5]]] as const) {
    stroke(v, [[px + m(a[0]), foot - 10], [px + m(b[0]), foot - m(b[1])]], { seed: 4101 + a[0] * 10, weight: 7, colour: steel });
  }
  stroke(v, [[px - m(0.3), foot - m(1.9)], [px + m(0.45), foot - m(1.5)]], { seed: 4105, weight: 7, colour: steel });
  for (let i = 0; i < 9; i++) v.ellipse(px + m(0.2), foot - m(1.55) + i * 7, 7, 3, { stroke: "#5a5a5e", weight: 1.6 });
  stroke(v, [[px + m(0.2), foot - m(1.55) + 64], [px + m(0.2), foot - m(1.0)]], { seed: 4106, weight: 1.4 });
  blob(v, roundRectPts(px + m(0.2) - 16, foot - m(1.0), 32, 8, 3), { fill: "#3a3a3e", seed: 4107, line: 1.4 });
  // A saddle facing the wall, a pedal, a crank arm, a padded thing for the chin.
  blob(v, [[px - m(0.6), foot - m(0.7)], [px - m(0.25), foot - m(0.72)], [px - m(0.22), foot - m(0.64)], [px - m(0.58), foot - m(0.6)]], { fill: "#c83a2a", light: "#e86a5a", seed: 4110, line: 2 });
  stroke(v, [[px - m(0.42), foot - m(0.62)], [px - m(0.45), foot - 12]], { seed: 4111, weight: 5, colour: steel });
  blob(v, ellipsePts(px - m(0.3), foot - m(1.45), 16, 10), { fill: "#c83a2a", light: "#e86a5a", seed: 4112, line: 1.8 });
  // The gauge plate.
  blob(v, roundRectPts(px + m(0.28), foot - m(0.95), m(0.36), m(0.3), 5), { fill: "#e8e0c8", seed: 4113, line: 1.8 });
  v.text("ZEST", { x: px + m(0.46), y: foot - m(0.7) }, { size: 7, fill: INK, align: "center", valign: "middle", style: "bold" });
  // The name plate, and the instructions card, blank.
  signBox(v, px - m(0.1), foot - m(2.15), 108, 18, "OMNI-FLEX 3000", { seed: 4120, face: "#e8c84a", size: 10 });
  const [cx, cy] = at(OMNI.x + 0.95, 1.55, 0);
  blob(v, [[cx - 24, cy - 30], [cx + 24, cy - 30], [cx + 24, cy + 30], [cx - 24, cy + 30]], { fill: "#f0ece0", seed: 4121, line: 1.4 });
  v.text("HOW TO USE:", { x: cx, y: cy - 20 }, { size: 6, fill: INK, align: "center", valign: "middle", style: "bold" });
  for (let i = 0; i < 4; i++) stroke(v, [[cx - 18, cy - 8 + i * 9], [cx + 18, cy - 8 + i * 9]], { seed: 4122 + i, weight: 1, colour: "rgba(60,50,40,0.15)", amp: 0.3 });
  v.text("?", { x: cx, y: cy + 10 }, { size: 18, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
}
function omniWheel(v: View, t: number): void {
  const [px, foot] = at(OMNI.x, 0, OMNI.depth);
  const cx = px + m(0.05), cy = foot - m(0.45), r = m(0.32);
  v.circle(cx, cy, r, { fill: "#3a3a40", stroke: INK, weight: 2.4 });
  v.circle(cx, cy, r - 7, { stroke: "#6a6a72", weight: 2 });
  for (let i = 0; i < 5; i++) {
    const a = t * 0.03 + (i / 5) * Math.PI * 2;
    v.line(cx, cy, cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8), { stroke: "#9aa0a8", weight: 2.6 });
  }
  v.circle(cx, cy, 6, { fill: "#c8c8cc", stroke: INK, weight: 1.4 });
  const a = t * 0.03;
  v.line(cx, cy, cx + Math.cos(a) * 26, cy + Math.sin(a) * 26, { stroke: "#c8c8cc", weight: 4 });
  // The zest gauge creeps up and falls back.
  const u = (Math.sin(t * 0.05) + 1) / 2;
  dial(v, px + m(0.46), foot - m(0.82), 11, u, 4130);
}

// --- A stationary bicycle, its front wheel gone, a NEW! sticker on it. ---------------------

function bike(v: View): void {
  const [px, foot] = at(BIKE.x, 0, BIKE.depth);
  const steel = "#e8e0d0";
  blob(v, roundRectPts(px - m(0.5), foot - 12, m(1.0), 12, 4), { fill: "#3a3a3e", seed: 4200, line: 1.8 });
  stroke(v, [[px - m(0.3), foot - 10], [px - m(0.15), foot - m(0.9)]], { seed: 4201, weight: 6, colour: steel });
  stroke(v, [[px - m(0.15), foot - m(0.5)], [px + m(0.3), foot - m(0.5)], [px + m(0.35), foot - m(1.05)]], { seed: 4202, weight: 6, colour: steel });
  stroke(v, [[px - m(0.3), foot - 10], [px + m(0.3), foot - m(0.5)]], { seed: 4203, weight: 6, colour: steel });
  blob(v, [[px - m(0.28), foot - m(0.95)], [px - m(0.02), foot - m(0.94)], [px - m(0.04), foot - m(0.88)], [px - m(0.26), foot - m(0.88)]], { fill: "#2a2a2e", seed: 4204, line: 1.8 });
  stroke(v, [[px + m(0.28), foot - m(1.05)], [px + m(0.44), foot - m(1.1)], [px + m(0.48), foot - m(1.0)]], { seed: 4205, weight: 4, colour: "#2a2a2e" });
  // Where the wheel was: an empty fork, the wheel leaning on the wall behind.
  stroke(v, [[px + m(0.3), foot - m(0.5)], [px + m(0.32), foot - m(0.2)]], { seed: 4206, weight: 4, colour: steel });
  blob(v, ellipsePts(px - m(0.15), foot - m(0.5), 16, 16), { fill: "#5a5a60", seed: 4207, line: 1.6 });
  v.at({ translate: [px + 22, foot - m(1.2)], rotate: -0.2 }, () => {
    v.rect(-16, -9, 32, 18, { fill: "#f8f048", stroke: INK, weight: 1 });
    v.text("NEW!", { x: 0, y: 0 }, { size: 9, fill: "#d02a2a", align: "center", valign: "middle", style: "bold" });
  });
}
function wheelOnWall(v: View): void {
  const [cx, cy] = at(BIKE.x + 0.75, 0.32, 0.25);
  v.circle(cx, cy, m(0.32), { stroke: INK, weight: 5 });
  v.circle(cx, cy, m(0.32), { stroke: "#3a3a3e", weight: 3 });
  for (let i = 0; i < 12; i++) v.line(cx, cy, cx + Math.cos(i * 0.52) * m(0.3), cy + Math.sin(i * 0.52) * m(0.3), { stroke: "#a8a8ac", weight: 0.8 });
  v.circle(cx, cy, 4, { fill: "#a8a8ac", stroke: INK, weight: 1 });
}

// --- Extreme resting -----------------------------------------------------------------------

function scoreboard(v: View): void {
  const [cx, cy] = at(BOARD.x, BOARD.h, 0);
  const w = m(1.7), h = m(0.85);
  blob(v, roundRectPts(cx - w / 2 - 8, cy - h / 2 - 8, w + 16, h + 16, 10), { fill: "#2a3a48", light: "#4a5a68", seed: 4300, line: 2.4 });
  blob(v, roundRectPts(cx - w / 2, cy - h / 2, w, h, 6), { fill: "#0e1418", seed: 4301, line: 1.6 });
  v.text("EXTREME RESTING", { x: cx, y: cy - h / 2 - 22 }, { size: 15, fill: "#f0e8c8", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
  v.text("RECORD: CITIZEN 04 · 31 DAYS", { x: cx, y: cy - h / 2 + 14 }, { size: 9, fill: "#f8c840", align: "center", valign: "middle", style: "bold" });
  v.text("(STILL GOING?)", { x: cx, y: cy - h / 2 + 26 }, { size: 7, fill: "#8a8a70", align: "center", valign: "middle" });
  for (const [i, [, , , num]] of NAPPERS.entries()) v.text(`#${num}`, { x: cx - w / 2 + 30, y: cy + 4 + i * 26 }, { size: 12, fill: "#9af0c0", align: "center", valign: "middle", style: "bold" });
}
function mats(v: View): void {
  for (const [i, [x, depth]] of NAPPERS.entries()) {
    const [px, foot] = at(x, 0, depth);
    const w = m(1.85);
    blob(v, [[px - 30, foot + 6], [px + w - 20, foot + 6], [px + w - 14, foot - 8], [px - 24, foot - 8]], { fill: i === 0 ? "#3a8ac8" : "#e8783a", light: i === 0 ? "#6ab0e8" : "#f8a06a", dark: "#1a2a3a", seed: 4310 + i, line: 2, shadeSide: "bottom" });
    blob(v, [[px - 22, foot - 8], [px + 20, foot - 8], [px + 18, foot - 22], [px - 18, foot - 24]], { fill: "#f0ece0", light: "#ffffff", seed: 4315 + i, line: 1.6 });
  }
  // A velvet rope between chrome posts, around the arena.
  const posts = [5.0, 6.3, 7.7].map((x): Vec2 => at(x, 0, 2.45));
  for (const [i, [x, y]] of posts.entries()) {
    blob(v, ellipsePts(x, y - 3, 12, 4), { fill: "#a8a8ac", seed: 4320 + i, line: 1.4 });
    stroke(v, [[x, y - 4], [x, y - m(0.9)]], { seed: 4325 + i, weight: 4, colour: "#d8d8dc" });
    v.circle(x, y - m(0.9), 6, { fill: "#e8d070", stroke: INK, weight: 1.4 });
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax, ay] = posts[i] ?? [0, 0], [bx] = posts[i + 1] ?? [0, 0];
    const rope: Vec2[] = Array.from({ length: 9 }, (_, k): Vec2 => [ax + (bx - ax) * (k / 8), ay - m(0.86) + Math.sin((k / 8) * Math.PI) * 26]);
    stroke(v, rope, { seed: 4330 + i, weight: 5, colour: "#8a1a2a" });
  }
  const [qx, qy] = posts[1] ?? [0, 0];
  v.at({ translate: [qx, qy - m(0.6)], rotate: 0.05 }, () => {
    v.rect(-30, -10, 60, 20, { fill: "#f0e8d0", stroke: INK, weight: 1.2 });
    v.text("SHHH! LIVE", { x: 0, y: 0 }, { size: 8, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  });
}
/** A citizen asleep on a mat under a blanket, head on a pillow, feet out the end. */
function napper(v: View, x: number, depth: number, suit: string, num: string, mask: boolean, t: number): void {
  const [px, foot] = at(x, 0, depth);
  const breathe = Math.sin(t * 0.05 + x * 3) * 2.5;
  const y = foot - 10;
  // Head on the pillow.
  blob(v, ellipsePts(px + 2, y - 22, 13, 12, 14), { fill: "#c58a62", light: "#e0aa82", seed: 4600 + x, line: 1.8 });
  blob(v, [[px - 12, y - 24], [px - 4, y - 36], [px + 12, y - 34], [px + 6, y - 28], [px - 8, y - 18]], { fill: mask ? "#2a1a10" : "#c8a060", seed: 4601 + x, line: 1.4 });
  if (mask) blob(v, roundRectPts(px + 4, y - 30, 12, 9, 3), { fill: "#d84a8a", seed: 4602 + x, line: 1.2 });
  else v.arc(px + 9, y - 22, 3, 0, Math.PI, { stroke: INK, weight: 1.2 });
  // The blanket, rising and falling.
  const top = y - 36 - breathe;
  const blanket: Vec2[] = [[px + 12, y + 2], [px + m(1.62), y + 2], [px + m(1.6), y - 18], [px + m(1.15), y - 22], [px + m(0.7), top - 4], [px + m(0.35), top], [px + 18, y - 24]];
  blob(v, blanket, { fill: suit, light: mixHex(suit, "#ffffff", 0.3), dark: mixHex(suit, "#000000", 0.35), seed: 4603 + x, line: 2.2, shadeSide: "bottom" });
  stroke(v, [[px + 20, y - 18], [px + m(0.35), top + 8]], { seed: 4604 + x, weight: 3, colour: "#06b6d4", amp: 0.5 });
  // Socked feet poking out.
  for (const dy of [-14, -6]) blob(v, ellipsePts(px + m(1.66), y + dy, 7, 5, 10), { fill: "#e8e0d0", seed: 4605 + x + dy, line: 1.2 });
  // Their competitor number on a little flag stuck in the mat.
  stroke(v, [[px + m(1.75), y + 4], [px + m(1.75), y - 46]], { seed: 4606 + x, weight: 1.6 });
  v.rect(px + m(1.75), y - 46, 22, 14, { fill: "#f0e8d0", stroke: INK, weight: 1 });
  v.text(num, { x: px + m(1.75) + 11, y: y - 39 }, { size: 8, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
}

function wallPieces(v: View): void {
  bunting(v, 4.2, 5.6, 2.8, ["#06b6d4", "#e8b83a", "#e8783a"]);
  poster(v, 0.95, "recreation", { h: 1.75 });
  // A chart of personal attributes, with no numbers filled in.
  const [sx, sy] = at(5.0, 1.55, 0);
  blob(v, [[sx - 34, sy - 52], [sx + 34, sy - 52], [sx + 34, sy + 52], [sx - 34, sy + 52]], { fill: "#e8dcb0", dark: "#a89a70", seed: 4400, line: 1.6 });
  v.text("RATE YOURSELF", { x: sx, y: sy - 42 }, { size: 6, fill: "#1a3a6a", align: "center", valign: "middle", style: "bold" });
  for (const [i, ch] of [..."SPECIAL"].entries()) {
    v.text(ch, { x: sx - 24, y: sy - 28 + i * 12 }, { size: 9, fill: "#1a3a6a", align: "center", valign: "middle", style: "bold" });
    v.rect(sx - 16, sy - 32 + i * 12, 44, 8, { stroke: "#1a3a6a", weight: 0.8 });
    if (i === 6) v.rect(sx - 16, sy - 32 + i * 12, 44, 8, { fill: "#d84a3a" });
  }
  v.text("LUCK: FULL", { x: sx, y: sy + 46 }, { size: 5, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  // Medicine balls on a rack, one missing.
  const [rx, ry] = at(7.95, 0, 0.3);
  blob(v, roundRectPts(rx - 34, ry - m(0.95), 68, m(0.95), 4), { fill: "#6a5040", light: "#8a6a50", seed: 4410, line: 2, shadeSide: "right" });
  for (let i = 0; i < 3; i++) {
    const by = ry - m(0.95) + 18 + i * 44;
    if (i === 1) continue;
    blob(v, ellipsePts(rx, by + 4, 22, 20), { fill: ["#8a3a2a", "#3a4a2a", "#2a3a5a"][i] ?? "#8a3a2a", light: "#c86a5a", seed: 4411 + i, line: 1.8 });
  }
  wheelOnWall(v);
  scoreboard(v);
  tubeLight(v, 2.9, 2.6, 1.4);
  clock(v, 1.75, 2.7, 3.95);
  amaSpeaker(v, 3.85, 2.35);
}
function furniture(v: View): void {
  beltColumn(v);
  omniFrame(v);
  bike(v);
  mats(v);
  // A dumbbell missing one end.
  const [dx, dy] = at(2.2, 0, 2.2);
  stroke(v, [[dx - 20, dy - 8], [dx + 20, dy - 8]], { seed: 4500, weight: 4, colour: "#8a8a8e" });
  blob(v, roundRectPts(dx - 30, dy - 18, 12, 20, 3), { fill: "#2a2a2e", seed: 4501, line: 1.4 });
}

function live(v: View, t: number): void {
  tubeGlow(v, 2.9, 2.6, t, { w: 1.4, flicker: true });
  beltStrap(v, t);
  omniWheel(v, t);
  for (const [i, [x, depth, suit, num, mask]] of NAPPERS.entries()) {
    napper(v, x, depth, suit, num, mask, t);
    // Z's drifting up from each.
    const [px, py] = at(x, 0, depth);
    const hx = px + 10;
    for (let k = 0; k < 3; k++) {
      const u = (t * 0.008 + k / 3 + i * 0.17) % 1;
      const a = Math.sin(u * Math.PI);
      v.text("z", { x: hx + u * 30 + Math.sin(u * 8) * 5, y: py - 50 - u * 90 }, { size: 10 + u * 12, fill: `rgba(240,240,255,${a.toFixed(3)})`, align: "center", valign: "middle", style: "bold" });
    }
  }
  // The scoreboard counts the current nappers' hours.
  const [cx, cy] = at(BOARD.x, BOARD.h, 0);
  const w = m(1.7);
  for (let i = 0; i < NAPPERS.length; i++) {
    const s = 3 * 3600 + 12 * 60 + i * 5407 + Math.floor(t / 2);
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    const txt = [hh, mm, ss].map((n) => n.toString().padStart(2, "0")).join(":");
    v.text(txt, { x: cx + w / 2 - 66, y: cy + 4 + i * 26 }, { size: 14, fill: "#ff9a30", align: "center", valign: "middle", style: "bold", font: "Courier, monospace" });
    glow(v, cx + w / 2 - 66, cy + 4 + i * 26, { rx: 60, ry: 14, colour: "#ff9a30", alpha: 0.25 });
  }
  glow(v, cx, cy, { rx: 160, ry: 80, colour: "#9af0c0", alpha: 0.08 });
  amaEye(v, 3.85, 2.35, t);
  // A citizen does laps of the room, slowly; another, standing, watches the nappers.
  const w1 = pacing(t, 0.7, 4.6, 0.014);
  citizen(v, { x: w1.x, facing: w1.facing, pose: "walk", suit: "#2a8a9a", collar: "#06b6d4", hair: "#1a1a1a", skin: "#8a5a3a", number: "22" }, t * 1.6);
  citizen(v, { x: 8.2, depth: 2.9, facing: -1, pose: "stand", suit: "#6a6a7a", collar: "#06b6d4", hair: "#e8e0d0", number: "60" }, t);
  // The referee's stopwatch.
  const [rx, ry] = at(8.07, 1.0, 2.9);
  v.circle(rx, ry, 5, { fill: "#e8e0d0", stroke: INK, weight: 1.2 });
  v.line(rx, ry, rx + Math.cos(t * 0.1) * 4, ry + Math.sin(t * 0.1) * 4, { stroke: INK, weight: 1 });
}

export const ACTIVITY_HUB: RoomSpec = {
  id: "activity-hub",
  name: "Activity Hub",
  width: 8.8,
  wall: "#06b6d4",
  trim: "#1a4a5a",
  sky: "birds",
  floor: "rubber",
  floorColour: "#3a4a50",
  ambient: "#a8b4bc",
  freshPaint: { from: 0.4, to: 3.3, colour: "#3ae0f0" },
  exits: [
    { to: "Hollow Atrium", kind: "edge-left", label: "Hollow Atrium", glow: "#f97316" },
    { to: "Joyous Cafe", kind: "edge-right", label: "Joyous Cafe", glow: "#eab308" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
};
