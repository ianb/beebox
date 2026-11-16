// A pendulum for a physics page: drag the length slider and watch the period
// change. The bob swings by the full equation of motion; the label gives the
// small-angle period 2π√(L/g), which the measured swing matches closely.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Style, View, TextOptions, Util, Vec2 } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 640, height: 440 };
export const params = {
  length: { type: "number", min: 0.25, max: 2, default: 1.2, step: 0.05, label: "length L (m)" },
} as const satisfies ParamsDecl;

const G = 9.81;
const FPS = 30;
const PX_PER_M = 160;
const PIVOT: Vec2 = [320, 56];
const TRAIL = 28;
const START_ANGLE = 0.42;

export interface Model {
  frame: number;
  theta: number;
  omega: number;
  /** Recent bob positions in metres from the pivot, oldest first. */
  trail: readonly Vec2[];
}

export function init(): Model {
  return { frame: 0, theta: START_ANGLE, omega: 0, trail: [] };
}

function step(model: DeepReadonly<Model>, length: number, frame: number): Model {
  // Semi-implicit Euler in 20 substeps per frame: stable and close enough.
  let { theta, omega } = model;
  const dt = 1 / FPS / 20;
  for (let i = 0; i < 20; i += 1) {
    omega -= (G / length) * Math.sin(theta) * dt;
    theta += omega * dt;
  }
  const bob: Vec2 = [length * Math.sin(theta), length * Math.cos(theta)];
  return { frame, theta, omega, trail: [...model.trail, bob].slice(-TRAIL) };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return step(model, u.params.length, msg.frame);
    case "param":
      // A new length restarts the swing from the same release angle.
      return { ...init(), frame: model.frame };
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "trigger":
      return { ...model };
  }
}

const INK = "#1f2933";
const ACCENT = "#c2410c";
const RULE: Style = { stroke: INK, weight: 1.5, cap: "butt" };
const TICK_LABEL: TextOptions = { size: 11, fill: "#52606d", align: "right", valign: "middle", font: "Helvetica, Arial, sans-serif" };
const LABEL: TextOptions = { size: 15, fill: INK, font: "Helvetica, Arial, sans-serif" };

// The spike does not support style.dash yet, so dashes are drawn as segments.
function dashed(v: View, from: Vec2, to: Vec2, style: Style): void {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let d = 0; d < len; d += 8) {
    const a = d / len;
    const b = Math.min(len, d + 4) / len;
    v.line(from[0] + (to[0] - from[0]) * a, from[1] + (to[1] - from[1]) * a, from[0] + (to[0] - from[0]) * b, from[1] + (to[1] - from[1]) * b, style);
  }
}

const toPx = ([x, y]: Vec2): Vec2 => [PIVOT[0] + x * PX_PER_M, PIVOT[1] + y * PX_PER_M];

function lengthScale(v: View, length: number): void {
  // A vertical ruler beside the pivot: minor ticks every 0.1 m, labels every 0.5 m.
  const x = 96;
  v.line(x, PIVOT[1], x, PIVOT[1] + 2 * PX_PER_M, RULE);
  for (let i = 0; i <= 20; i += 1) {
    const y = PIVOT[1] + (i / 10) * PX_PER_M;
    const major = i % 5 === 0;
    v.line(x, y, x + (major ? 14 : 7), y, { ...RULE, weight: major ? 1.5 : 1 });
    if (major) v.text(`${(i / 10).toFixed(1)} m`, { x: x - 6, y }, TICK_LABEL);
  }
  // The current length, marked on the ruler and carried across to the pivot line.
  const y = PIVOT[1] + length * PX_PER_M;
  v.polygon([[x + 16, y], [x + 26, y - 6], [x + 26, y + 6]], { fill: ACCENT });
  dashed(v, [x + 28, y], [PIVOT[0] - 40, y], { stroke: "#cbd2d9", weight: 1 });
}

function protractor(v: View, length: number): void {
  // Degree ticks on an arc just outside the bob's path, every 5°, labelled every 15°.
  const r = length * PX_PER_M + 24;
  v.arc(PIVOT[0], PIVOT[1], r, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62, { stroke: "#9aa5b1", weight: 1 });
  for (let d = -35; d <= 35; d += 5) {
    const a = Math.PI / 2 - (d * Math.PI) / 180;
    const long = d % 15 === 0;
    const r2 = r + (long ? 9 : 5);
    v.line(PIVOT[0] + r * Math.cos(a), PIVOT[1] + r * Math.sin(a), PIVOT[0] + r2 * Math.cos(a), PIVOT[1] + r2 * Math.sin(a), { stroke: "#9aa5b1", weight: 1 });
    if (long && d !== 0) {
      v.text(`${Math.abs(d)}°`, { x: PIVOT[0] + (r + 20) * Math.cos(a), y: PIVOT[1] + (r + 20) * Math.sin(a) }, { ...TICK_LABEL, align: "center" });
    }
  }
}

function labelBox(v: View, lines: readonly string[], top: number): void {
  // A box sized to its text: measure each line, then pad.
  const pad = 12;
  const gap = 6;
  const sizes = lines.map((s) => v.textBounds(s, { x: 0, y: 0 }, LABEL));
  const w = Math.max(...sizes.map((b) => b.w)) + pad * 2;
  const h = sizes.reduce((sum, b) => sum + b.h, 0) + gap * (lines.length - 1) + pad * 2;
  const at: Vec2 = [v.width - w - 16, top];
  v.group({ name: "period label", effects: { shadow: { x: 0, y: 2, blur: 6, color: "rgba(15,23,42,0.18)" } } }, () => {
    v.roundRect(at[0], at[1], w, h, 6, { fill: "#ffffff", stroke: "#cbd2d9", weight: 1 });
  });
  let y = at[1] + pad;
  for (const [i, s] of lines.entries()) {
    v.text(s, { x: at[0] + pad, y }, i === 0 ? { ...LABEL, style: "bold" } : LABEL);
    y += (sizes[i]?.h ?? 0) + gap;
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#f8fafc");
  // Faint grid, 0.25 m squares.
  for (let gx = PIVOT[0] - 2 * PX_PER_M; gx <= v.width; gx += PX_PER_M / 4) v.line(gx, 0, gx, v.height, { stroke: "#eef1f4", weight: 1 });
  for (let gy = PIVOT[1]; gy <= v.height; gy += PX_PER_M / 4) v.line(0, gy, v.width, gy, { stroke: "#eef1f4", weight: 1 });

  lengthScale(v, p.length);
  protractor(v, p.length);

  // Ceiling mount with hatching.
  v.rect(PIVOT[0] - 60, PIVOT[1] - 14, 120, 14, { fill: "#e4e7eb" });
  for (let i = 0; i < 12; i += 1) v.line(PIVOT[0] - 56 + i * 10, PIVOT[1] - 2, PIVOT[0] - 48 + i * 10, PIVOT[1] - 12, { stroke: "#9aa5b1", weight: 1 });
  v.line(PIVOT[0] - 60, PIVOT[1], PIVOT[0] + 60, PIVOT[1], { stroke: INK, weight: 2 });
  dashed(v, PIVOT, [PIVOT[0], PIVOT[1] + p.length * PX_PER_M + 26], { stroke: "#cbd2d9", weight: 1 });

  // Trail: older positions fainter and smaller.
  for (const [i, pt] of model.trail.entries()) {
    const k = (i + 1) / model.trail.length;
    const [x, y] = toPx(pt);
    v.circle(x, y, 3 + 5 * k, { fill: `rgba(194,65,12,${(0.04 + 0.22 * k * k).toFixed(3)})` });
  }

  const bob = toPx([p.length * Math.sin(model.theta), p.length * Math.cos(model.theta)]);
  v.line(PIVOT[0], PIVOT[1], bob[0], bob[1], { stroke: INK, weight: 2, cap: "round" });
  v.circle(PIVOT[0], PIVOT[1], 4, { fill: INK });
  v.group({ name: "bob", effects: { shadow: { x: 0, y: 3, blur: 5, color: "rgba(15,23,42,0.25)" } } }, () => {
    v.circle(bob[0], bob[1], 16, { fill: v.radialGradient(bob[0] - 5, bob[1] - 6, 18, [[0, "#fdba74"], [1, ACCENT]]), stroke: "#7c2d12", weight: 1.5 });
  });

  const period = 2 * Math.PI * Math.sqrt(p.length / G);
  const angle = (model.theta * 180) / Math.PI;
  labelBox(v, [`Period T = ${period.toFixed(2)} s`, `T = 2π√(L / g),  L = ${p.length.toFixed(2)} m`, `angle ${angle >= 0 ? "+" : "−"}${Math.abs(angle).toFixed(1)}°`], 24);
  v.text("Length L (m)", { x: 24, y: 384 }, { ...LABEL, size: 12, fill: "#52606d" });
  v.control("length", { x: 24, y: 402, w: 220 });
}
