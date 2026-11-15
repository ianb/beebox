// Tranquil Pool. From intra-game: "Tranquil Pool: a small room centred on a
// perfectly still pool of water. Plastic plants line the edges, colours too
// vibrant. Sky: pink and orange sunset, horizon flickering as though struggling
// to hold together."
// Exits (2): Archive Lounge (edge-left), Joyous Cafe (door).
import type { Vec2, SceneView as View } from "@ianbicking/canvas-loop";
import { INK, type RoomSpec, at, blob, ellipsePts, glow, hash, mixHex, roundRectPts, stroke } from "./kit-tea.js";
import { amaEye, amaSpeaker, bench, citizen, plant, poster } from "./props-tea.js";
import { footY, m } from "./sizes-tea.js";

/** The pool, in the floor: x from..to (m), depth from..to (m). */
const POOL = { x0: 1.55, x1: 5.35, d0: 0.6, d1: 2.35 };
const PALM = { x: 0.95, depth: 0.55 };
const CHAIR = { x: 5.95, depth: 1.25 };
const COUNTER = { x: 2.55, h: 2.15 };
/** Plastic plants along the pool's back edge: [x m, leaf, height]. */
const PLANTS = [[1.85, "#ff2ad8", 0.9], [3.05, "#2aff5a", 1.1], [4.2, "#ffe81a", 0.8], [5.05, "#2ae8ff", 1.0]] as const;

function poolRect(): { x: number; y: number; w: number; h: number } {
  const [x, y] = at(POOL.x0, 0, POOL.d0), [x1, y1] = at(POOL.x1, 0, POOL.d1);
  return { x, y, w: x1 - x, h: y1 - y };
}

/** A plastic palm: segmented trunk, a crown of stiff fronds, a coconut or two. */
function palm(v: View, x: number, depth: number): void {
  const [px, foot] = at(x, 0, depth);
  blob(v, [[px - 22, foot], [px + 22, foot], [px + 26, foot - 34], [px - 26, foot - 34]], { fill: "#e8e0d0", dark: "#8a8070", seed: 6000, line: 2 });
  const top: Vec2 = [px + 20, foot - m(1.85)];
  for (let i = 0; i < 9; i++) {
    const u0 = i / 9, u1 = (i + 1) / 9;
    const ax = px + (top[0] - px) * u0 * u0, ay = foot - 34 + (top[1] - foot + 34) * u0;
    const bx = px + (top[0] - px) * u1 * u1, by = foot - 34 + (top[1] - foot + 34) * u1;
    blob(v, [[ax - 9, ay], [ax + 9, ay], [bx + 8, by + 2], [bx - 8, by + 2]], { fill: "#b8865a", light: "#d8a878", seed: 6001 + i, line: 1.6, amp: 0.4 });
  }
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + (i / 6) * Math.PI + (hash(i, 0, 6010) - 0.5) * 0.2;
    const len = m(0.75 + hash(i, 1, 6011) * 0.25);
    const tip: Vec2 = [top[0] + Math.cos(a) * len, top[1] + Math.sin(a) * len * 0.45 + len * 0.35];
    const mid: Vec2 = [top[0] + Math.cos(a) * len * 0.5, top[1] + Math.sin(a) * len * 0.5 - 10];
    blob(v, [top, [mid[0], mid[1] - 9], tip, [mid[0], mid[1] + 9]], { fill: i % 2 === 0 ? "#1aff6a" : "#5aff2a", light: "#c8ffb0", seed: 6020 + i, line: 1.6, amp: 0.6 });
  }
  for (const dx of [-8, 8]) blob(v, ellipsePts(top[0] + dx, top[1] + 10, 8, 8), { fill: "#6a4a2a", seed: 6030 + dx, line: 1.4 });
  v.rect(px + 6, foot - 26, 14, 9, { fill: "#f8f048" });
}

/** The tiled lower wall a pool room should have, and the poolside signs. */
function poolWall(v: View): void {
  const [x0, y0] = at(0, 1.0, 0), [x1, y1] = at(8.0, 0.5, 0);
  v.rect(x0, y0, x1 - x0, y1 - y0, { fill: "#f0d8e0" });
  for (let x = x0; x < x1; x += 18) v.line(x, y0, x, y1, { stroke: "rgba(160,110,130,0.5)", weight: 1 });
  for (let y = y0; y < y1; y += 18) v.line(x0, y, x1, y, { stroke: "rgba(160,110,130,0.5)", weight: 1 });
  for (let i = 0; i < 26; i++) {
    // Missing and replaced tiles: a few in the wrong colour.
    const tx = x0 + Math.floor(hash(i, 0, 6100) * ((x1 - x0) / 18)) * 18, ty = y0 + Math.floor(hash(i, 1, 6101) * ((y1 - y0) / 18)) * 18;
    v.rect(tx + 1, ty + 1, 16, 16, { fill: i % 3 === 0 ? "#3a3036" : i % 3 === 1 ? "#a8e0d8" : "#f8a8c8" });
  }
  stroke(v, [[x0, y0], [x1, y0]], { seed: 6102, weight: 1.6, amp: 0.5 });
  // The counter of days without a ripple.
  const [cx, cy] = at(COUNTER.x, COUNTER.h, 0);
  blob(v, roundRectPts(cx - 74, cy - 38, 148, 76, 6), { fill: "#f4ecdc", dark: "#a8987a", seed: 6110, line: 2.2 });
  v.text("DAYS WITHOUT", { x: cx, y: cy - 26 }, { size: 9, fill: "#8a1a3a", align: "center", valign: "middle", style: "bold" });
  v.text("A RIPPLE", { x: cx, y: cy - 15 }, { size: 9, fill: "#8a1a3a", align: "center", valign: "middle", style: "bold" });
  blob(v, roundRectPts(cx - 50, cy - 6, 100, 30, 3), { fill: "#1a1418", seed: 6111, line: 1.4 });
  v.text("NO SPLASHING · NO SWIMMING · NO RIPPLES", { x: m(4.6), y: at(0, 1.25, 0)[1] }, { size: 9, fill: mixHex("#ec4899", "#2a1020", 0.6), align: "center", valign: "middle", style: "bold" });
  // A pipe along the ceiling with a drip that never falls.
  const [ax, ay] = at(3.1, 2.75, 0), [bx] = at(5.5, 2.75, 0);
  stroke(v, [[ax - 40, ay], [bx, ay]], { seed: 6120, weight: m(0.09), colour: "#7a6a62" });
  stroke(v, [[ax - 40, ay - 6], [bx, ay - 6]], { seed: 6121, weight: 2, colour: "#a8988e" });
  blob(v, roundRectPts(ax + 80, ay - 10, 14, 20, 3), { fill: "#5a4a42", seed: 6122, line: 1.4 });
}

function poolBody(v: View): void {
  const r = poolRect();
  // The coping, in pink and white tiles; then the water, flat as glass.
  blob(v, roundRectPts(r.x - 14, r.y - 6, r.w + 28, r.h + 14, 6), { fill: "#f8e8ee", light: "#ffffff", dark: "#c8a8b4", seed: 6200, line: 2.2 });
  for (let x = r.x - 10; x < r.x + r.w + 10; x += 22) v.line(x, r.y - 5, x + 2, r.y + r.h + 7, { stroke: "rgba(200,140,170,0.35)", weight: 1 });
  v.rect(r.x, r.y, r.w, r.h, { fill: v.linearGradient(0, r.y, 0, r.y + r.h, [[0, "#fde68a"], [0.22, "#fb923c"], [0.5, "#ec4899"], [1, "#831843"]]) });
  v.rect(r.x, r.y, r.w, r.h, { stroke: INK, weight: 2.2 });
  // Reflections: the plants and the chair upside down in it, perfectly.
  v.clip([[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], () => {
    v.group({ opacity: 0.32 }, () => {
      v.at({ translate: [0, 2 * r.y - 2], scale: [1, -1] }, () => {
        for (const [x, leaf, h] of PLANTS) plant(v, x, POOL.d0 - 0.15, { h, leaf, pot: "#f8f0f4" });
      });
    });
  });
  // The ladder: chrome rails curving over the back edge.
  for (const dx of [0, 26]) {
    const lx = r.x + r.w - 60 + dx;
    stroke(v, [[lx, r.y + 14], [lx, r.y - 30], [lx - 10, r.y - 44], [lx - 22, r.y - 40]], { seed: 6210 + dx, weight: 4, colour: "#d8d8e0" });
    stroke(v, [[lx, r.y + 14], [lx, r.y - 30], [lx - 10, r.y - 44], [lx - 22, r.y - 40]], { seed: 6212 + dx, weight: 1, amp: 0.3 });
  }
}

/** The lifeguard's chair: tall, white, empty, a whistle on a cord. */
function lifeguardChair(v: View): void {
  const [px, foot] = at(CHAIR.x, 0, CHAIR.depth);
  const legs: [Vec2, Vec2][] = [[[px - 30, foot], [px - 18, foot - m(1.3)]], [[px + 30, foot], [px + 18, foot - m(1.3)]]];
  for (const [a, b] of legs) stroke(v, [a, b], { seed: 6300 + a[0], weight: 6, colour: "#f0ece4" });
  for (const [a, b] of legs) stroke(v, [a, b], { seed: 6302 + a[0], weight: 1.2, amp: 0.3 });
  for (let i = 1; i < 5; i++) {
    const y = foot - i * m(0.26), dx = 30 - i * 2.4;
    stroke(v, [[px - dx, y], [px + dx, y]], { seed: 6310 + i, weight: 4, colour: "#e8e4dc" });
  }
  blob(v, roundRectPts(px - 28, foot - m(1.36), 56, 10, 3), { fill: "#e8e4dc", seed: 6320, line: 1.8 });
  blob(v, [[px + 18, foot - m(1.36)], [px + 26, foot - m(1.36)], [px + 30, foot - m(1.95)], [px + 22, foot - m(1.95)]], { fill: "#e8e4dc", seed: 6321, line: 1.8 });
  // An umbrella, faded.
  stroke(v, [[px + 26, foot - m(1.9)], [px + 28, foot - m(2.4)]], { seed: 6322, weight: 2.4, colour: "#8a8a8e" });
  blob(v, [[px - 36, foot - m(2.25)], [px + 28, foot - m(2.5)], [px + 92, foot - m(2.25)], [px + 28, foot - m(2.32)]], { fill: "#f0a0b8", light: "#f8d0dc", seed: 6323, line: 1.8 });
  stroke(v, [[px + 4, foot - m(1.6)], [px + 8, foot - m(1.45)], [px + 6, foot - m(1.3)]], { seed: 6324, weight: 1 });
  v.circle(px + 6, foot - m(1.28), 4, { fill: "#d8402a", stroke: INK, weight: 1 });
  v.at({ translate: [px, foot - m(0.8)], rotate: 0.06 }, () => {
    v.rect(-30, -11, 60, 22, { fill: "#f8f0e0", stroke: INK, weight: 1.2 });
    v.text("LIFEGUARD", { x: 0, y: -4 }, { size: 7, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
    v.text("ON DUTY", { x: 0, y: 5 }, { size: 7, fill: "#8a1a1a", align: "center", valign: "middle", style: "bold" });
  });
}

/** The rubber duck, sat on the water without a ripple. */
function duck(v: View, x: number, y: number): void {
  blob(v, [[x - 14, y], [x + 12, y], [x + 16, y - 10], [x + 6, y - 12], [x - 12, y - 10]], { fill: "#f8d81a", light: "#fff080", seed: 6400, line: 1.6 });
  blob(v, ellipsePts(x + 8, y - 18, 7, 7), { fill: "#f8d81a", seed: 6401, line: 1.4 });
  blob(v, [[x + 14, y - 18], [x + 22, y - 16], [x + 14, y - 14]], { fill: "#f87a1a", seed: 6402, line: 1 });
}

function wallPieces(v: View): void {
  poolWall(v);
  poster(v, 3.95, "calm", { h: 1.75 });
  amaSpeaker(v, 5.1, 2.45);
}
function furniture(v: View): void {
  palm(v, PALM.x, PALM.depth);
  for (const [x, leaf, h] of PLANTS) plant(v, x, POOL.d0 - 0.15, { h, leaf, pot: "#f8f0f4" });
  poolBody(v);
  lifeguardChair(v);
  bench(v, 6.75, 2.35, { w: 1.1, colour: "#f0a0b8" });
  plant(v, 7.9, 0.55, { h: 1.3, leaf: "#ff5a1a" });
}

function live(v: View, t: number): void {
  const r = poolRect();
  // The horizon in the water: a bright line that jumps when the sky's does, and
  // sometimes tears into two.
  const jump = Math.sin(t * 0.7) > 0.6 ? 2 : 0;
  const hy = r.y + r.h * 0.22 + jump;
  v.rect(r.x + 2, hy, r.w - 4, 1.6, { fill: "#fff7ed" });
  if (hash(Math.floor(t / 3), 0, 6500) < 0.2) {
    const off = Math.floor(hash(t, 1, 6501) * 30) - 15;
    v.rect(r.x + 2 + Math.max(0, off), hy + 5, r.w * 0.6, 1.2, { fill: "rgba(255,247,237,0.6)" });
  }
  glow(v, r.x + r.w / 2, hy, { rx: r.w * 0.55, ry: 18, colour: "#ffb070", alpha: 0.3 });
  // The sun, mirrored, sinking and never set.
  v.circle(r.x + r.w * 0.62, hy + 3, 6, { fill: "#fff1c8" });
  // The duck: its eye is red, and lit.
  const dx = r.x + r.w * 0.3, dy = r.y + r.h * 0.6;
  duck(v, dx, dy);
  const look = Math.floor(t / 45) % 2 === 0 ? 0 : 1;
  v.circle(dx + 9 + look, dy - 19, 1.6, { fill: "#ff3020" });
  glow(v, dx + 9, dy - 19, { rx: 6, colour: "#ff3020", alpha: 0.6 });
  // The drip on the pipe: it swells, it hangs, it does not fall.
  const [px, py] = at(3.1, 2.75, 0);
  const u = Math.min(1, (t % 120) / 60);
  const dropY = py + 12 + u * 10;
  v.ellipse(px + 87, dropY, 3 + u * 1.5, 4 + u * 2.5, { fill: "rgba(200,230,255,0.85)", stroke: INK, weight: 1 });
  // The counter: unchanged, as it should be.
  const [cx, cy] = at(COUNTER.x, COUNTER.h, 0);
  v.text("4,017", { x: cx, y: cy + 9 }, { size: 18, fill: "#5af08a", align: "center", valign: "middle", style: "bold", font: "Courier, monospace" });
  glow(v, cx, cy + 9, { rx: 50, ry: 16, colour: "#5af08a", alpha: hash(Math.floor(t / 6), 0, 6502) < 0.1 ? 0.1 : 0.3 });
  amaEye(v, 5.1, 2.45, t);
  // A citizen sits on the bench, contemplating the stillness. Very still.
  citizen(v, { x: 6.5, depth: 2.4, facing: -1, pose: "sit", suit: "#3a7a8a", collar: "#ec4899", hair: "#e8c070", skin: "#e0b090" }, t);
  // Sunset light on the floor around the pool.
  glow(v, r.x + r.w / 2, footY(1.4), { rx: r.w * 0.7, ry: 40, colour: "#ff80b0", alpha: 0.18 });
}

export const TRANQUIL_POOL: RoomSpec = {
  id: "tranquil-pool",
  name: "Tranquil Pool",
  width: 8.0,
  wall: "#ec4899",
  trim: "#6a1a3a",
  sky: "pink-sunset",
  floor: "tiles",
  floorColour: "#b08a8a",
  ambient: "#c8a8b8",
  exits: [
    { to: "Archive Lounge", kind: "edge-left", label: "Archive Lounge", glow: "#3b82f6" },
    { to: "Joyous Cafe", kind: "door", x: 7.3, style: "slide", label: "Joyous Cafe", glow: "#eab308" },
  ],
  paintWall: wallPieces,
  paintFurniture: furniture,
  live,
  rim: { x: m(3.5), y: 160, colour: "#ff9ac0", reach: 700 },
};

