// An educational figure: a simple pendulum. A slider over the canvas sets the
// length; the period shows in a box sized to its text; a faint trail follows
// the bob; a ruler beside the pivot has tick marks every 10 cm.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, TextOptions, Util } from "../../../core/tea.js";
import type { Style, Vec2, View } from "../../scene-api.js";

export const params = {
  length: { type: "number", min: 0.3, max: 2, default: 1, step: 0.05, label: "Length", hint: "metres" },
} as const satisfies ParamsDecl;
type P = typeof params;

export const canvas = { width: 480, height: 420 };

const G = 9.81;
const DT = 1 / 60;
const PX_PER_M = 150;
const PIVOT: Vec2 = [200, 40];
const TRAIL = 36;

export interface Model {
  readonly frame: number;
  /** Angle from straight down, radians. */
  readonly theta: number;
  readonly omega: number;
  /** Past bob positions in canvas pixels, oldest first. */
  readonly trail: readonly Vec2[];
}

export function init(): Model {
  return { frame: 0, theta: 0.5, omega: 0, trail: [] };
}

function bob(theta: number, length: number): Vec2 {
  return [PIVOT[0] + Math.sin(theta) * length * PX_PER_M, PIVOT[1] + Math.cos(theta) * length * PX_PER_M];
}

// eslint-disable-next-line max-params -- TEA contract signature
export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<P>): Model {
  if (msg.type !== "tick") return model;
  const length = u.params.length;
  const omega = model.omega - (G / length) * Math.sin(model.theta) * DT;
  const theta = model.theta + omega * DT;
  const trail = [...model.trail, bob(theta, length)].slice(-TRAIL);
  return { frame: msg.frame, theta, omega, trail };
}

// --- Static parts: the ceiling and the ruler -------------------------------------------

const INK = "#1f2937";
const MUTED = "#6b7280";
const ACCENT = "#2563eb";
const LABEL: TextOptions = { size: 11, fill: MUTED, valign: "middle" };
const RULER_X = 390;

function ruler(v: View): void {
  const scale = v.picture({ key: "ruler", width: 60, height: 2.1 * PX_PER_M }, () => {
    v.line(0, 0, 0, 2 * PX_PER_M, { stroke: INK, weight: 1.5, cap: "square" });
    for (let cm = 0; cm <= 200; cm += 10) {
      const y = (cm / 100) * PX_PER_M;
      const major = cm % 50 === 0;
      v.line(0, y, major ? 12 : 6, y, { stroke: INK, weight: major ? 1.5 : 1, cap: "butt" });
      if (major) v.text(`${(cm / 100).toFixed(1)} m`, { x: 16, y }, LABEL);
    }
  });
  v.place(scale, RULER_X, PIVOT[1]);
}

function ceiling(v: View): void {
  v.rect(PIVOT[0] - 70, PIVOT[1] - 14, 140, 14, { fill: "#e5e7eb", stroke: INK, weight: 1.5 });
  for (let x = PIVOT[0] - 64; x < PIVOT[0] + 70; x += 10) {
    v.line(x, PIVOT[1] - 14, x + 8, PIVOT[1] - 22, { stroke: MUTED, weight: 1, cap: "round" });
  }
}

// --- The label in a box sized to its text ----------------------------------------------

function labelBox(v: View, a: { readonly text: string; readonly at: Vec2 }): void {
  const opts: TextOptions = { size: 15, fill: INK, align: "left", valign: "top", font: "Helvetica, Arial, sans-serif" };
  const pad = 8;
  const b = v.textBounds(a.text, { x: a.at[0] + pad, y: a.at[1] + pad }, opts);
  v.roundRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad, 6, { fill: "#ffffff", stroke: "#cbd5e1", weight: 1 });
  v.text(a.text, { x: a.at[0] + pad, y: a.at[1] + pad }, opts);
}

// --- Draw ------------------------------------------------------------------------------

// eslint-disable-next-line max-params -- TEA contract signature
export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<P>): void {
  v.background("#fbfbf8");
  ruler(v);
  ceiling(v);

  // The current length marked on the ruler, joined to the rest position by a dashed guide.
  const restY = PIVOT[1] + p.length * PX_PER_M;
  v.line(PIVOT[0], restY, RULER_X, restY, { stroke: "#cbd5e1", weight: 1, dash: [4, 4] });
  v.triangle(RULER_X, restY, RULER_X - 9, restY - 5, RULER_X - 9, restY + 5, { fill: ACCENT });

  // The trail: older positions fainter and smaller.
  const n = model.trail.length;
  for (const [i, [x, y]] of model.trail.entries()) {
    const age = (i + 1) / n;
    v.circle(x, y, 2 + 3 * age, { fill: `rgba(37,99,235,${(0.05 + 0.25 * age).toFixed(3)})` });
  }

  const [bx, by] = bob(model.theta, p.length);
  const string: Style = { stroke: INK, weight: 1.5, cap: "round" };
  v.line(PIVOT[0], PIVOT[1], bx, by, string);
  v.circle(PIVOT[0], PIVOT[1], 3, { fill: INK });
  v.circle(bx, by, 14, { fill: v.radialGradient(bx - 4, by - 4, 16, [[0, "#93c5fd"], [1, ACCENT]]), stroke: "#1e3a8a", weight: 1.5 });

  // The angle, as an arc from straight down.
  const theta = model.theta;
  if (Math.abs(theta) > 0.02) {
    const [a0, a1] = theta > 0 ? [Math.PI / 2 - theta, Math.PI / 2] : [Math.PI / 2, Math.PI / 2 - theta];
    v.arc(PIVOT[0], PIVOT[1], 40, a0, a1, { stroke: MUTED, weight: 1 });
    v.line(PIVOT[0], PIVOT[1], PIVOT[0], PIVOT[1] + 50, { stroke: MUTED, weight: 1, dash: [2, 3] });
  }

  const period = 2 * Math.PI * Math.sqrt(p.length / G);
  labelBox(v, { text: `Period T = 2π√(L/g) = ${period.toFixed(2)} s`, at: [16, 330] });

  v.text(`Length L = ${p.length.toFixed(2)} m`, { x: 16, y: 382 }, { size: 12, fill: INK, valign: "middle" });
  v.control("length", { x: 150, y: 372, w: 220 });
}
