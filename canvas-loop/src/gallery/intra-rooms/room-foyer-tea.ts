// Intake Foyer. From intra-game: "Intake Foyer: a small room, a passage from the
// intake area. Two doors, each with a sign above it serving as directions:
// 'Hollow Atrium' and 'Intake'." In the game the Atrium door is locked until the
// player tries the pad; it is very easy.
// Exits (2): Intake (edge-left), Hollow Atrium (edge-right).
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { signBox } from "./parts-a-tea.js";
import { amaEye, amaSpeaker, bench, citizen, pacing, plant } from "./props-tea.js";
import { footY, m } from "./sizes-tea.js";

const WIDTH = 5.6;
/** The lit signs over the two doorways: [x m, text, arrow direction]. */
const LIGHTBOXES = [[1.3, "INTAKE", -1], [3.95, "HOLLOW ATRIUM", 1]] as const;
const LIGHTBOX_H = 2.8;
const MAP = { x: 2.55, h: 1.62, w: 1.3, hh: 0.92 };
const KEYPAD = { x: 4.95, h: 1.25 };
const POST = { x: 3.7, depth: 1.5 };

/** The map of Intra on the board: [col, row, colour]. Foyer is (1, 2). */
const ROOMS_ON_MAP: readonly (readonly [number, number, string])[] = [
  [0, 2, "#84cc16"], [1, 2, "#10b981"], [2, 2, "#f97316"], [2, 1, "#34d399"], [3, 0, "#ec4899"], [3, 1, "#3b82f6"], [4, 1, "#ec4899"],
  [4, 2, "#eab308"], [3, 2, "#06b6d4"], [1, 3, "#facc15"], [2, 3, "#6366f1"], [3, 3, "#a3a3a3"], [1, 4, "#94a3b8"], [2, 4, "#a855f7"],
  [1, 5, "#f43f5e"], [2, 5, "#14b8a6"], [3, 5, "#fda4af"], [5, 4, "#64748b"], [5, 5, "#78716c"],
];
function mapCell(col: number, row: number): Vec2 {
  const [cx, cy] = at(MAP.x, MAP.h, 0);
  const w = m(MAP.w), h = m(MAP.hh);
  return [cx - w / 2 + 22 + col * ((w - 44) / 5), cy - h / 2 + 30 + row * ((h - 46) / 5)];
}

function arrow(v: View, x: number, y: number, dir: number, size: number, colour: string): void {
  v.polygon([[x + dir * size, y], [x, y - size * 0.7], [x, y - size * 0.3], [x - dir * size, y - size * 0.3], [x - dir * size, y + size * 0.3], [x, y + size * 0.3], [x, y + size * 0.7]], { fill: colour });
}

function lightboxes(v: View): void {
  for (const [i, [x, text, dir]] of LIGHTBOXES.entries()) {
    const [cx, cy] = at(x, LIGHTBOX_H, 0);
    const w = text.length * 11 + 50;
    signBox(v, cx, cy, w, 26, text, { seed: 3000 + i * 10, face: "#f4ecc8", ink: "#1a4a3a", size: 14 });
    arrow(v, cx + dir * (w / 2 - 14), cy, dir, 9, "#c83a2a");
  }
}

function mapBoard(v: View): void {
  const [cx, cy] = at(MAP.x, MAP.h, 0);
  const w = m(MAP.w), h = m(MAP.hh);
  blob(v, roundRectPts(cx - w / 2 - 8, cy - h / 2 - 8, w + 16, h + 16, 10), { fill: "#8a6a42", light: "#b08a5a", dark: "#4a3a24", seed: 3100, line: 2.4 });
  blob(v, roundRectPts(cx - w / 2, cy - h / 2, w, h, 6), { fill: "#e8e0c8", dark: "#a89a7a", seed: 3101, line: 1.6 });
  v.text("WELCOME TO INTRA", { x: cx, y: cy - h / 2 + 13 }, { size: 11, fill: "#1a4a3a", align: "center", valign: "middle", style: "bold", font: "Helvetica, Arial, sans-serif" });
  // Corridors, then the rooms.
  for (const [col, row] of ROOMS_ON_MAP) {
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      if (!ROOMS_ON_MAP.some(([c, r]) => c === col + dc && r === row + dr)) continue;
      const [ax, ay] = mapCell(col, row), [bx, by] = mapCell(col + dc, row + dr);
      v.line(ax, ay, bx, by, { stroke: "#8a8070", weight: 2 });
    }
  }
  for (const [i, [col, row, c]] of ROOMS_ON_MAP.entries()) {
    const [x, y] = mapCell(col, row);
    blob(v, roundRectPts(x - 11, y - 6, 22, 12, 3), { fill: mixHex(c, "#e8e0c8", 0.25), seed: 3110 + i, line: 1.2, amp: 0.3 });
  }
  // Someone scratched out the way to the surface.
  const [sx, sy] = mapCell(0, 0);
  v.text("SURFACE", { x: sx + 4, y: sy - 4 }, { size: 7, fill: "#5a4a3a", align: "center", valign: "middle", style: "bold" });
  stroke(v, [[sx - 20, sy - 2], [sx + 26, sy - 6]], { seed: 3150, weight: 2.4, colour: "#8a1a1a" });
  stroke(v, [[sx - 18, sy - 8], [sx + 24, sy + 1]], { seed: 3151, weight: 2.4, colour: "#8a1a1a" });
  v.text("YOU ARE HERE", { x: cx + w / 2 - 40, y: cy + h / 2 - 9 }, { size: 7, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  v.circle(cx + w / 2 - 84, cy + h / 2 - 9, 3, { fill: "#d82a1a" });
}

function keypad(v: View): void {
  const [cx, cy] = at(KEYPAD.x, KEYPAD.h, 0);
  blob(v, roundRectPts(cx - 22, cy - 40, 44, 80, 8), { fill: "#b8b4a8", light: "#e0dcd0", dark: "#6a665c", seed: 3200, line: 2, shadeSide: "right" });
  blob(v, roundRectPts(cx - 16, cy - 34, 32, 14, 3), { fill: "#1a1e1a", seed: 3201, line: 1.2, amp: 0.3 });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
    v.rect(cx - 14 + c * 10, cy - 12 + r * 10, 8, 7, { fill: r === 3 && c === 2 ? "#5aa84a" : "#e8e4d8", stroke: INK, weight: 0.8 });
  }
  // A sticky note with the code, and an arrow someone drew in marker.
  v.at({ translate: [cx - 36, cy - 30], rotate: -0.12 }, () => {
    v.rect(-14, -12, 28, 24, { fill: "#f8e860" });
    v.text("CODE:", { x: 0, y: -4 }, { size: 6, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" });
    v.text("1234", { x: 0, y: 5 }, { size: 7, fill: "#3a2a10", align: "center", valign: "middle", style: "bold" });
  });
  stroke(v, [[cx + 20, cy + 62], [cx + 30, cy + 54], [cx + 26, cy + 38]], { seed: 3210, weight: 2, colour: "#c83a2a", amp: 0.6 });
  stroke(v, [[cx + 21, cy + 44], [cx + 26, cy + 38], [cx + 32, cy + 43]], { seed: 3211, weight: 2, colour: "#c83a2a", amp: 0.3 });
  v.text("PRESS ANY KEY", { x: cx, y: cy + 68 }, { size: 8, fill: "#ffb090", align: "center", valign: "middle", style: "bold" });
  stroke(v, [[cx, cy + 40], [cx + 4, cy + 70], [cx + 2, footY(0) - m(0.5)]], { seed: 3212, weight: 2.4, colour: "#3a3a3e" });
}

/** A signpost in the middle of the room, as if the room were a crossroads. */
function signpost(v: View): void {
  const [px, foot] = at(POST.x, 0, POST.depth);
  blob(v, ellipsePts(px, foot - 4, 24, 7), { fill: "#5a5a5e", seed: 3300, line: 1.8 });
  blob(v, roundRectPts(px - 5, foot - m(2.15), 10, m(2.15) - 4, 3), { fill: "#c8c8cc", light: "#ffffff", dark: "#7a7a7e", seed: 3301, line: 1.8, shadeSide: "right" });
  const arms: readonly (readonly [string, number, number, string])[] = [
    ["INTAKE", -1, 2.0, "#84cc16"], ["ATRIUM", 1, 1.86, "#f97316"], ["INTAKE", 1, 1.72, "#84cc16"], ["THE SURFACE", -1, 1.58, "#7a7a7a"], ["HERE", 1, 1.44, "#10b981"],
  ];
  for (const [i, [text, dir, h, c]] of arms.entries()) {
    const y = foot - m(h), len = text.length * 7 + 26;
    v.at({ translate: [px, y], rotate: (hash(i, 0, 3302) - 0.5) * 0.12 }, () => {
      const pts: Vec2[] = [[0, -8], [dir * (len - 10), -8], [dir * len, 0], [dir * (len - 10), 8], [0, 8]];
      blob(v, pts, { fill: mixHex(c, "#e8e0c8", 0.45), seed: 3303 + i, line: 1.6, amp: 0.4 });
      v.text(text, { x: dir * (len / 2 - 3), y: 0.5 }, { size: 8, fill: "#2a2018", align: "center", valign: "middle", style: "bold" });
      if (text === "THE SURFACE") stroke(v, [[dir * 6, 0], [dir * (len - 6), 1]], { seed: 3310, weight: 2, colour: "#8a1a1a" });
    });
  }
}

function pamphlets(v: View): void {
  const [px, foot] = at(4.4, 0, 0.5);
  stroke(v, [[px - 14, foot], [px, foot - m(0.9)], [px + 14, foot]], { seed: 3400, weight: 3, colour: "#8a8a8e" });
  blob(v, [[px - 28, foot - m(0.9)], [px + 28, foot - m(0.9)], [px + 30, foot - m(1.35)], [px - 30, foot - m(1.35)]], { fill: "#d87a3a", light: "#f0a060", dark: "#8a4a20", seed: 3401, line: 2 });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
    const x = px - 24 + c * 25, y = foot - m(1.33) + r * 32;
    blob(v, [[x, y], [x + 22, y], [x + 22, y + 26], [x, y + 26]], { fill: ["#f0e8d0", "#e8f0f8", "#f8e8e8", "#f0e8d0"][r * 2 + c] ?? "#f0e8d0", seed: 3402 + r * 2 + c, line: 1.2, amp: 0.3 });
    v.text(["SO YOU", "CLONES", "FUN!", "SMILE"][r * 2 + c] ?? "", { x: x + 11, y: y + 7 }, { size: 5, fill: "#3a2a20", align: "center", valign: "middle", style: "bold" });
    v.circle(x + 11, y + 17, 4, { fill: "#f8d048" });
  }
  v.text("TAKE ONE", { x: px, y: foot - m(0.9) - 8 }, { size: 6, fill: "#f8f0e0", align: "center", valign: "middle", style: "bold" });
  // One fell on the floor.
  v.at({ translate: [px + 50, foot + 20], rotate: 0.4 }, () => blob(v, [[-10, -4], [10, -4], [10, 4], [-10, 4]], { fill: "#f0e8d0", seed: 3410, line: 1, amp: 0.2 }));
}

/** Arrows painted on the floor, worn by feet, pointing both ways at once. */
function floorArrows(v: View): void {
  const y = footY(2.2);
  for (const [x, dir] of [[1.6, -1], [3.0, 1], [4.4, -1]] as const) {
    v.at({ translate: [m(x), y], scale: [1, 0.35] }, () => arrow(v, 0, 0, dir, 26, "rgba(250,240,200,0.6)"));
  }
}

function wallPieces(v: View): void {
  lightboxes(v);
  mapBoard(v);
  keypad(v);
  amaSpeaker(v, 1.9, 2.45);
}
function furniture(v: View): void {
  floorArrows(v);
  pamphlets(v);
  bench(v, 2.45, 0.9, { w: 1.3, colour: "#3a8a6a" });
  plant(v, 0.8, 0.55, { h: 1.0, leaf: "#2aa85a" });
  signpost(v);
}

function live(v: View, t: number): void {
  for (const [i, [x, text]] of LIGHTBOXES.entries()) {
    const [cx, cy] = at(x, LIGHTBOX_H, 0);
    // The Intake sign stutters.
    const on = i === 1 || hash(Math.floor(t / 2), 0, 3500) > 0.12;
    if (on) glow(v, cx, cy + 4, { rx: text.length * 9 + 40, ry: 40, colour: "#fff0c0", alpha: 0.45 });
  }
  // The map: here is here, and also, now and then, somewhere else.
  const [hx, hy] = mapCell(1, 2);
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.2);
  v.circle(hx, hy, 3.5, { fill: "#e82a1a" });
  glow(v, hx, hy, { rx: 10 + pulse * 6, colour: "#ff3020", alpha: 0.6 });
  const other = ROOMS_ON_MAP[Math.floor(hash(Math.floor(t / 25), 0, 3501) * ROOMS_ON_MAP.length)];
  if (other !== undefined && Math.floor(t / 25) % 2 === 1) {
    const [ox, oy] = mapCell(other[0], other[1]);
    v.circle(ox, oy, 3.5, { fill: "#e82a1a" });
    glow(v, ox, oy, { rx: 12, colour: "#ff3020", alpha: 0.5 });
  }
  // The keypad: locked, blinking, asking for any key at all.
  const [kx, ky] = at(KEYPAD.x, KEYPAD.h, 0);
  const blink = Math.floor(t / 10) % 2 === 0;
  v.text(blink ? "LOCKED" : "ANY KEY", { x: kx, y: ky - 27 }, { size: 6, fill: "#ff5040", align: "center", valign: "middle", style: "bold" });
  glow(v, kx, ky - 27, { rx: 22, ry: 12, colour: "#ff4030", alpha: blink ? 0.5 : 0.3 });
  // A red stripe of light across the locked doorway.
  const [dx] = at(WIDTH, 0, 0);
  glow(v, dx - 20, at(0, 1.1, 1.5)[1], { rx: 18, ry: 120, colour: "#ff3020", alpha: 0.25 + 0.1 * Math.sin(t * 0.1) });
  amaEye(v, 1.9, 2.45, t);
  const w = pacing(t + 40, 0.6, 3.3, 0.008);
  citizen(v, { x: w.x, facing: w.facing, pose: "walk", suit: "#4a7a5a", collar: "#10b981", hair: "#a86a3a", skin: "#e0b090", number: "12" }, t);
}

export const FOYER: RoomSpec = {
  id: "foyer",
  name: "Intake Foyer",
  width: WIDTH,
  wall: "#10b981",
  trim: "#1a4a3a",
  sky: "still-clouds",
  floor: "tiles",
  ambient: "#a8b8b0",
  freshPaint: { from: 0.35, to: 1.5, colour: "#4ae0a8" },
  exits: [
    { to: "Intake", kind: "edge-left", label: "Intake", glow: "#84cc16" },
    { to: "Hollow Atrium", kind: "edge-right", label: "Hollow Atrium", glow: "#f97316" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
};
