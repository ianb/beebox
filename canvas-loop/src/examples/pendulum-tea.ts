// Physics stepped in `update`: each tick advances the swing by a fixed 1/60 s
// (the check's fps), split into substeps so the integration stays stable.
// The length slider sits on the canvas (`v.control`); a new length restarts
// the swing from the release angle. Because every run gives the same frames,
// a snapshot 60·T ticks after a release, with T the small-angle period
// 2π√(L/g), checks the swing: the bob is back within a hair of where it
// started. Linked from TEA.md "Frame-N guarantee".
import type { DeepReadonly, Msg, ParamValues, ParamsDecl, RootDrawing, TextOptions, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  length: { type: "number", min: 0.3, max: 1.6, step: 0.05, default: 1.2, label: "Length (m)" },
} as const satisfies ParamsDecl;

export const canvas = { width: 480, height: 400 };

const G = 9.81;
const DT = 1 / 60;
const SUBSTEPS = 20;
const RELEASE = 0.3;
const PX_PER_M = 180;
const PIVOT = { x: 240, y: 60 } as const;
const INK = "#2b2a33";
const LABEL: TextOptions = { size: 14, fill: INK };

export interface Model {
  /** Angle from straight down, radians, and its rate. */
  theta: number;
  omega: number;
}

export function init(_u: Util<typeof params>): Model {
  return { theta: RELEASE, omega: 0 };
}

/** One tick: 1/60 s of θ'' = −(g/L)·sin θ, by semi-implicit Euler in substeps. */
function swing(model: DeepReadonly<Model>, length: number): Model {
  let { theta, omega } = model;
  const h = DT / SUBSTEPS;
  for (let i = 0; i < SUBSTEPS; i += 1) {
    omega -= (G / length) * Math.sin(theta) * h;
    theta += omega * h;
  }
  return { theta, omega };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
      return swing(model, u.params.length);
    case "param":
      return init(u);
    case "mousedown":
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "mouseleave":
    case "trigger":
      return model;
  }
}

export function draw(v: View, model: DeepReadonly<Model>, p: ParamValues<typeof params>): RootDrawing {
  const r = p.length * PX_PER_M;
  const bob = { x: PIVOT.x + r * Math.sin(model.theta), y: PIVOT.y + r * Math.cos(model.theta) };
  const period = 2 * Math.PI * Math.sqrt(p.length / G);
  v.control("length", { x: 300, y: 352, w: 160 });
  return [
    v.background("#f1ece2"),
    // The swing's range, and the line straight down.
    v.arc(PIVOT.x, PIVOT.y, r, Math.PI / 2 - RELEASE, Math.PI / 2 + RELEASE, { stroke: "#c9bfae", weight: 1.5, dash: [4, 5] }),
    v.line(PIVOT.x, PIVOT.y, PIVOT.x, PIVOT.y + r + 26, { stroke: "#d8cfbf", weight: 1 }),
    v.rect(PIVOT.x - 70, PIVOT.y - 14, 140, 14, { fill: "#6b5b4b" }),
    v.line(PIVOT.x, PIVOT.y, bob.x, bob.y, { stroke: INK, weight: 1.5 }),
    v.circle(PIVOT.x, PIVOT.y, 3, { fill: INK }),
    v.circle(bob.x, bob.y, 16, { fill: v.radialGradient(bob.x - 5, bob.y - 6, 22, [[0, "#f4d58a"], [0.6, "#c48a2c"], [1, "#6e4a12"]]) }),
    v.text(`L = ${p.length.toFixed(2)} m    T = 2π√(L/g) = ${period.toFixed(2)} s`, { x: 20, y: 360 }, LABEL),
  ];
}
