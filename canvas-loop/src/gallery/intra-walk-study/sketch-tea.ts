// Walk study: the rooms' old walker beside three walkers driven by measured gait
// (gait-tea.ts), crossing one floor at the rooms' scale with their footprints
// left behind; a Muybridge-style strip of one stride; and the measured curves.
import type { DeepReadonly, Msg, View } from "@ianbicking/canvas-loop";
import { INK, blob, ellipsePts, stroke } from "./ink-tea.js";
import { CURVES, STYLES, footprints, pose, progress, strideLength } from "./gait-tea.js";
import type { Style } from "./gait-tea.js";
import { LOOK, mixHex, skeleton, walker } from "./figure-tea.js";
import type { Look } from "./figure-tea.js";
import { DEPTH_PX_PER_M, PX_PER_M, m } from "./sizes-tea.js";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 1280, height: 1000 };

export interface Model {
  frame: number;
}
export function init(): Model {
  return { frame: 0 };
}
export function update(model: DeepReadonly<Model>, msg: Msg): Model {
  switch (msg.type) {
    case "tick":
      return { frame: model.frame + 1 };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

const WALL_FOOT = 330;
const floorY = (depth: number): number => WALL_FOOT + depth * DEPTH_PX_PER_M;
const WRAP = canvas.width + 320;
const TEXT = { size: 13, fill: "#2a2420", align: "left", valign: "top" } as const;

function room(v: View): void {
  v.rect(0, 0, canvas.width, WALL_FOOT, { fill: "#8a8a6e" });
  for (let x = 0; x < canvas.width; x += m(1.2)) v.line(x, 30, x, WALL_FOOT, { stroke: "rgba(0,0,0,0.18)", weight: 2 });
  v.rect(0, WALL_FOOT - 50, canvas.width, 50, { fill: "#6e6e58" });
  v.rect(0, WALL_FOOT, canvas.width, 560 - WALL_FOOT, { fill: "#b9ab8e" });
  for (let d = 0.5; d < 7; d += 0.5) v.line(0, floorY(d), canvas.width, floorY(d), { stroke: "rgba(60,40,20,0.12)", weight: 1 });
  // Metre marks along the front edge.
  for (let x = 0; x < canvas.width; x += PX_PER_M) {
    v.line(x, 548, x, 560, { stroke: INK, weight: 1.5 });
    v.text(`${Math.round(x / PX_PER_M)} m`, { x: x + 3, y: 545 }, { size: 10, fill: "#4a3e34", align: "left", valign: "bottom" });
  }
  v.text("Same floor, same scale (145 px per metre). Footprints show where each foot stood flat.", { x: 16, y: 12 }, { ...TEXT, fill: "#f4ecd8" });
}

// --- The kit's walker, as it was (props-tea.ts `citizen` + `pacing`) ------------------------

function oldWalker(v: View, frame: number, depth: number): void {
  const metres = (frame * 0.009) % (WRAP / PX_PER_M);
  const x = metres * PX_PER_M - 160, y = floorY(depth);
  const k = m(1.65) / 140;
  const suit = "#6a4a8a", step = Math.sin(frame * 0.3);
  v.at({ translate: [x, y], scale: [k, k] }, () => {
    v.ellipse(0, 0, 24, 6, { fill: "rgba(0,0,0,0.4)" });
    for (const s of [-1, 1]) {
      const sw = s * step * 10;
      blob(v, [[-5 + sw * 0.3, -62], [5 + sw * 0.3, -62], [6 + sw, -2], [-3 + sw, -2]], { fill: mixHex(suit, "#000000", 0.15), seed: 804 + s, line: 1.6, amp: 0.4 });
      blob(v, ellipsePts(sw + 5, -2, 9, 4.5, 10), { fill: "#1a1410", seed: 806 + s, line: 1.2, amp: 0.3 });
    }
    blob(v, [[-14, -58], [14, -58], [12, -112], [0, -116], [-12, -112]], { fill: suit, seed: 808, line: 2 });
    stroke(v, [[-13, -66], [13, -66]], { seed: 809, weight: 3, colour: "#2a2420", amp: 0.3 });
    blob(v, ellipsePts(2, -127, 11, 13, 14), { fill: "#c58a62", seed: 811, line: 1.8 });
    blob(v, [[-11, -129], [10, -138], [12, -128], [0, -141], [-10, -138]], { fill: "#2e1d15", seed: 812, line: 1.4 });
    v.circle(9, -127, 1.3, { fill: "#1a1010" });
    blob(v, [[9, -108], [15, -104], [18 + step * 4, -70], [12 + step * 4, -68], [7, -100]], { fill: suit, seed: 813, line: 1.6 });
  });
  v.text("before: the rooms' walker", { x, y: y - m(1.65) - 22 }, { size: 12, fill: "#3a2a4a", align: "center", valign: "bottom", style: "bold" });
}

// --- Measured walkers -------------------------------------------------------------------------

interface Lane {
  name: string;
  style: Style;
  depth: number;
  start: number;
  look: Look;
}
const LANES: Lane[] = [
  { name: "measured: ordinary", style: STYLES.ordinary, depth: 2.2, start: 2, look: LOOK },
  { name: "weary (smaller, slower, slumped)", style: STYLES.weary, depth: 3.0, start: 5.5, look: { suit: "#7a6a3a", collar: "#c8503a", skin: "#a8744e", hair: "#8a8a84", seed: 940 } },
  { name: "brisk (bigger, quicker)", style: STYLES.brisk, depth: 4.4, start: 0, look: { suit: "#3a7a5a", collar: "#e8b83a", skin: "#e0b090", hair: "#a04a20", seed: 980 } },
];

function lane(v: View, l: Lane, sec: number): void {
  const pr = progress(l.style, sec);
  const unwrapped = m(l.start + pr.x);
  const shift = Math.floor((unwrapped + 160) / WRAP) * WRAP;
  const x = unwrapped - shift, y = floorY(l.depth);
  const strides = sec * l.style.cadence;
  for (const f of footprints(l.style, strides - 4, strides)) {
    const fx0 = m(l.start + f.heel) - shift, fx1 = m(l.start + f.ball) - shift;
    if (fx1 > x + 4) continue;
    const yy = y + (f.near ? 5 : -5);
    v.ellipse((fx0 + fx1) / 2, yy, (fx1 - fx0) / 2 + 5, 4, { fill: f.near ? "rgba(60,30,10,0.35)" : "rgba(60,30,10,0.2)" });
  }
  walker(v, pose(l.style, pr.phase), { x, y, s: PX_PER_M, facing: 1 }, l.look);
  const speed = strideLength(l.style) * l.style.cadence;
  v.text(`${l.name} · ${speed.toFixed(2)} m/s`, { x, y: y - m(1.65) - 22 }, { size: 12, fill: "#1a2a3a", align: "center", valign: "bottom", style: "bold" });
}

// --- One stride, Muybridge-style --------------------------------------------------------------

const STRIP = { x: 20, y: 580, w: 820, h: 400 };
function strip(v: View, phaseNow: number): void {
  const { x, y, w, h } = STRIP;
  v.rect(x, y, w, h, { fill: "#16140f" });
  for (let gx = x; gx <= x + w; gx += 20) v.line(gx, y, gx, y + h, { stroke: "rgba(240,230,210,0.13)", weight: 1 });
  for (let gy = y; gy <= y + h; gy += 20) v.line(x, gy, x + w, gy, { stroke: "rgba(240,230,210,0.13)", weight: 1 });
  v.text("One stride of the measured walk, every 1/8. Ink figure over its skeleton; the current frame is lit.", { x: x + 10, y: y + 8 }, { ...TEXT, fill: "#e8dcc0" });
  const S = 95, ground = y + h - 30;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    const cx = x + 70 + i * 98;
    const ps = pose(STYLES.ordinary, p);
    const lit = Math.abs(((phaseNow - p + 1.5) % 1) - 0.5) < 0.5 / n;
    if (lit) v.rect(cx - 50, y + 34, 98, h - 40, { fill: "rgba(240,200,120,0.18)" });
    walker(v, ps, { x: cx, y: ground, s: S, facing: 1 });
    skeleton(v, ps, { x: cx, y: ground, s: S, facing: 1 }, { colour: "#ffd27a", weight: 1.2 });
    v.text(`${Math.round(p * 100)}%`, { x: cx, y: ground + 8 }, { size: 11, fill: "#e8dcc0", align: "center", valign: "top" });
  }
  v.line(x, ground, x + w, ground, { stroke: "#e8dcc0", weight: 1 });
}

// --- The measured curves ----------------------------------------------------------------------

const PLOT = { x: 870, y: 580, w: 390, h: 400 };
function curves(v: View, phaseNow: number): void {
  const { x, y, w, h } = PLOT;
  v.rect(x, y, w, h, { fill: "#f4ecd8", stroke: INK, weight: 1 });
  v.text("Joint angles over one stride (degrees), mean of 10 people", { x: x + 10, y: y + 8 }, { size: 12, fill: "#2a2420", align: "left", valign: "top" });
  const rows = [
    { name: "hip (forward +)", f: CURVES.hip, lo: -15, hi: 35, c: "#2a5a9a" },
    { name: "knee (bent +)", f: CURVES.knee, lo: 0, hi: 70, c: "#9a3a2a" },
    { name: "ankle (toe up +)", f: CURVES.ankle, lo: -15, hi: 20, c: "#3a7a3a" },
  ];
  const rh = (h - 50) / rows.length;
  for (const [i, r] of rows.entries()) {
    const top = y + 36 + i * rh, bot = top + rh - 22;
    const Y = (d: number): number => bot - ((d - r.lo) / (r.hi - r.lo)) * (bot - top);
    v.line(x + 40, Y(0), x + w - 12, Y(0), { stroke: "rgba(0,0,0,0.25)", weight: 1 });
    const pts: [number, number][] = [];
    for (let k = 0; k <= 100; k++) pts.push([x + 40 + ((w - 52) * k) / 100, Y(r.f(k / 100))]);
    v.curve(pts, false, { stroke: r.c, weight: 2.4 });
    const cx = x + 40 + (w - 52) * phaseNow;
    v.circle(cx, Y(r.f(phaseNow)), 4, { fill: r.c });
    v.text(r.name, { x: x + 44, y: top - 4 }, { size: 11, fill: r.c, align: "left", valign: "top", style: "bold" });
    v.text(`${r.hi}°`, { x: x + 36, y: top }, { size: 9, fill: "#6a5e54", align: "right", valign: "middle" });
    v.text(`${r.lo}°`, { x: x + 36, y: bot }, { size: 9, fill: "#6a5e54", align: "right", valign: "middle" });
  }
  const cx = x + 40 + (w - 52) * phaseNow;
  v.line(cx, y + 30, cx, y + h - 22, { stroke: "rgba(0,0,0,0.35)", weight: 1 });
  v.text("heel strike → stance → toe off (60%) → swing → heel strike", { x: x + w / 2, y: y + h - 8 }, { size: 10, fill: "#6a5e54", align: "center", valign: "bottom" });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.rect(0, 0, canvas.width, canvas.height, { fill: "#d8ccb0" });
  room(v);
  const sec = model.frame / 60;
  oldWalker(v, model.frame, 1.4);
  for (const l of LANES) lane(v, l, sec);
  const phase = progress(STYLES.ordinary, sec).phase;
  strip(v, phase);
  curves(v, phase);
}
