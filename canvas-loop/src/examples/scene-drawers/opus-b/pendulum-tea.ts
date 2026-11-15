// A simple pendulum for a physics lesson. The length is a slider; the period
// T = 2π√(L/g) is shown in a box sized to its text. A ruler beside the string
// is marked in tenths of a metre, an arc under the pivot in degrees, and the
// bob leaves a fading trail of where it has been.
import type { DeepReadonly, Msg, ParamValues, ParamsDecl, SceneStyle as Style, TextOptions, Util, SceneView as View, Vec2 } from "@ianbicking/canvas-loop";

export const params = {
  length: { type: "number", min: 0.3, max: 2, step: 0.05, default: 1, label: "Length (m)" },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 440 };

const G = 9.81;
const DT = 1 / 60;
const PX_PER_M = 150;
const PIVOT: Vec2 = [300, 60];
const START_ANGLE = 0.5;
const TRAIL = 36;

export interface Model {
  readonly angle: number;
  readonly speed: number;
  readonly frame: number;
  readonly trail: readonly number[];
}

export function init(): Model {
  return { angle: START_ANGLE, speed: 0, frame: 0, trail: [] };
}

/** One step of the full (not small-angle) equation, semi-implicit Euler in four substeps. */
function step(m: DeepReadonly<Model>, length: number): Model {
  let { angle, speed } = m;
  for (let i = 0; i < 4; i += 1) {
    speed += (-G / length) * Math.sin(angle) * (DT / 4);
    angle += speed * (DT / 4);
  }
  const trail = m.frame % 2 === 0 ? [...m.trail, angle].slice(-TRAIL) : [...m.trail];
  return { angle, speed, frame: m.frame + 1, trail };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return step(model, u.params.length);
    case "param":
      // A new length starts a fresh swing from the same release angle.
      return init();
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "trigger":
      return model;
  }
}

const INK = "#1f2937";
const MUTED = "#64748b";
const ACCENT = "#c2410c";
const LABEL: TextOptions = { size: 12, fill: MUTED, font: "sans-serif" };
const TICK: Style = { stroke: MUTED, weight: 1 };
const TICK_MAJOR: Style = { stroke: INK, weight: 1.5 };

/** A dashed line drawn as short segments (the spike has no `dash` yet). */
function dashed(v: View, a: Vec2, b: Vec2, style: Style): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.floor(len / 7);
  for (let i = 0; i < n; i += 1) {
    const t0 = (i * 7) / len;
    const t1 = Math.min(1, (i * 7 + 3.5) / len);
    v.line(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, style);
  }
}

function bobAt(angle: number, length: number): Vec2 {
  const r = length * PX_PER_M;
  return [PIVOT[0] + r * Math.sin(angle), PIVOT[1] + r * Math.cos(angle)];
}

function ruler(v: View, length: number): void {
  const x = 120;
  const [, y0] = PIVOT;
  v.line(x, y0, x, y0 + 2 * PX_PER_M, { stroke: INK, weight: 1.5 });
  for (let i = 0; i <= 20; i += 1) {
    const y = y0 + (i / 10) * PX_PER_M;
    const major = i % 5 === 0;
    v.line(x - (major ? 10 : 5), y, x, y, major ? TICK_MAJOR : TICK);
    if (major) v.text(`${(i / 10).toFixed(1)} m`, { x: x - 14, y }, { ...LABEL, align: "right", valign: "middle" });
  }
  // The current length, carried across to the bob's rest height.
  const yL = y0 + length * PX_PER_M;
  dashed(v, [x, yL], [PIVOT[0], yL], { stroke: ACCENT, weight: 1 });
  v.polygon([[x + 1, yL], [x + 9, yL - 5], [x + 9, yL + 5]], { fill: ACCENT });
  v.text("L", { x: x + 14, y: yL - 4 }, { ...LABEL, fill: ACCENT, style: "italic", size: 14, valign: "bottom" });
}

function protractor(v: View, length: number): void {
  const [px, py] = PIVOT;
  // Inside the bob's path, so the bob never covers the scale.
  const r = Math.min(80, length * PX_PER_M * 0.55);
  v.arc(px, py, r, Math.PI / 2 - 0.9, Math.PI / 2 + 0.9, { stroke: MUTED, weight: 1 });
  for (let deg = -50; deg <= 50; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const major = deg % 10 === 0;
    const r0 = major ? r - 8 : r - 4;
    v.line(px + r0 * Math.sin(a), py + r0 * Math.cos(a), px + r * Math.sin(a), py + r * Math.cos(a), major && deg !== 0 ? TICK_MAJOR : TICK);
    if (r > 55 && major && deg % 20 === 0 && deg !== 0) v.text(`${Math.abs(deg)}°`, { x: px + (r + 12) * Math.sin(a), y: py + (r + 12) * Math.cos(a) }, { ...LABEL, size: 10, align: "center", valign: "middle" });
  }
  dashed(v, [px, py], [px, py + r + 6], { stroke: MUTED, weight: 1 });
}

/** A label in a box that fits it, padded; returns the box. */
function boxedLabel(v: View, lines: readonly [string, string], at: Vec2): void {
  const head: TextOptions = { size: 15, fill: INK, font: "sans-serif", style: "bold" };
  const body: TextOptions = { size: 13, fill: MUTED, font: "sans-serif" };
  const pad = 12;
  const a = v.textBounds(lines[0], { x: 0, y: 0 }, head);
  const b = v.textBounds(lines[1], { x: 0, y: 0 }, body);
  const w = Math.max(a.w, b.w) + pad * 2;
  const h = a.h + b.h + 6 + pad * 2;
  const [x, y] = at;
  v.group({ effects: { shadow: { x: 0, y: 2, blur: 6, color: "rgba(15,23,42,0.18)" } } }, () => {
    v.roundRect(x, y, w, h, 8, { fill: "#ffffff", stroke: "#cbd5e1", weight: 1 });
  });
  v.rect(x, y + 10, 3, h - 20, { fill: ACCENT });
  v.text(lines[0], { x: x + pad, y: y + pad }, head);
  v.text(lines[1], { x: x + pad, y: y + pad + a.h + 6 }, body);
}

/** T against L over the slider's range, with the current length marked. */
function periodGraph(v: View, length: number): void {
  const [x, y, w, h] = [460, 160, 150, 150];
  const { min, max } = params.length;
  const tMax = 3;
  const gx = (l: number): number => x + ((l - min) / (max - min)) * w;
  const gy = (t: number): number => y + h - (t / tMax) * h;
  const T = (l: number): number => 2 * Math.PI * Math.sqrt(l / G);
  v.line(x, y + h, x + w, y + h, { stroke: INK, weight: 1 });
  v.line(x, y, x, y + h, { stroke: INK, weight: 1 });
  for (let t = 0; t <= tMax; t += 1) {
    v.line(x - 4, gy(t), x, gy(t), TICK);
    v.text(`${t} s`, { x: x - 7, y: gy(t) }, { ...LABEL, size: 10, align: "right", valign: "middle" });
  }
  for (const l of [0.5, 1, 1.5, 2]) {
    v.line(gx(l), y + h, gx(l), y + h + 4, TICK);
    v.text(`${l}`, { x: gx(l), y: y + h + 6 }, { ...LABEL, size: 10, align: "center" });
  }
  const pts: Vec2[] = [];
  for (let i = 0; i <= 30; i += 1) {
    const l = min + ((max - min) * i) / 30;
    pts.push([gx(l), gy(T(l))]);
  }
  v.curve(pts, false, { stroke: MUTED, weight: 1.5 });
  v.line(gx(length), gy(T(length)), gx(length), y + h, { stroke: ACCENT, weight: 1 });
  v.circle(gx(length), gy(T(length)), 4.5, { fill: ACCENT, stroke: "#ffffff", weight: 1.5 });
  v.text("T against L (m)", { x, y: y - 18 }, { ...LABEL, fill: INK, size: 12 });
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  const L = p.length;
  const period = 2 * Math.PI * Math.sqrt(L / G);
  v.background("#f8fafc");
  for (let x = 0; x <= v.width; x += 20) v.line(x, 0, x, v.height, { stroke: "#eef2f7", weight: 1 });
  for (let y = 0; y <= v.height; y += 20) v.line(0, y, v.width, y, { stroke: "#eef2f7", weight: 1 });
  ruler(v, L);
  protractor(v, L);
  // Trail: older positions fainter and smaller.
  for (const [i, angle] of model.trail.entries()) {
    const k = (i + 1) / model.trail.length;
    const [tx, ty] = bobAt(angle, L);
    v.circle(tx, ty, 2 + 5 * k, { fill: `rgba(194,65,12,${(0.06 + 0.3 * k * k).toFixed(3)})` });
  }
  const [bx, by] = bobAt(model.angle, L);
  v.line(PIVOT[0], PIVOT[1], bx, by, { stroke: INK, weight: 1.5, cap: "round" });
  v.rect(PIVOT[0] - 40, PIVOT[1] - 12, 80, 12, { fill: "#cbd5e1", stroke: INK, weight: 1 });
  for (let i = 0; i < 8; i += 1) v.line(PIVOT[0] - 36 + i * 10, PIVOT[1] - 12, PIVOT[0] - 30 + i * 10, PIVOT[1] - 20, { stroke: MUTED, weight: 1 });
  v.circle(PIVOT[0], PIVOT[1], 3.5, { fill: INK });
  v.group({ effects: { shadow: { x: 2, y: 4, blur: 6, color: "rgba(15,23,42,0.25)" } } }, () => {
    v.circle(bx, by, 16, { fill: v.radialGradient(bx - 5, by - 6, 18, [[0, "#fb923c"], [1, ACCENT]]), stroke: "#7c2d12", weight: 1.5 });
  });
  const deg = (model.angle * 180) / Math.PI;
  // The angle label sits beyond the bob, along the string, clear of the scale.
  const out = 34 / (L * PX_PER_M);
  v.text(`θ = ${deg.toFixed(0)}°`, { x: bx + (bx - PIVOT[0]) * out, y: by + (by - PIVOT[1]) * out + 4 }, { ...LABEL, fill: INK, align: "center", valign: "top", halo: "#f8fafc" });
  boxedLabel(v, [`Period T = ${period.toFixed(2)} s`, `T = 2π√(L/g),  L = ${L.toFixed(2)} m`], [440, 60]);
  periodGraph(v, L);
  v.text("Length", { x: 440, y: 386 }, { ...LABEL, fill: INK, valign: "bottom" });
  v.control("length", { x: 440, y: 392, w: 170, h: 24 });
}
