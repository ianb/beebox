// Every brush preset under every pressure, chosen with params, on three
// strokes and a ring. Linked from BRUSHES.md "Brushes".
import type { Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Style, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  brush: { type: "select", options: ["ink", "marker", "pencil", "chalk", "airbrush", "wash", "bristle"] as const, default: "bristle" },
  pressure: { type: "select", options: ["taper", "even", "swell", "press", "taper-out"] as const, default: "taper" },
  weight: { type: "number", min: 1, max: 60, step: 1, default: 18 },
  wobble: { type: "number", min: 0, max: 8, step: 0.5, default: 1.5 },
  paper: { type: "number", min: 0, max: 1, step: 0.05, default: 0.2 },
} as const satisfies ParamsDecl;

export const canvas = { width: 480, height: 320 };

type Model = Record<string, never>;

export function init(_u: Util<typeof params>): Model {
  return {};
}

export function update(model: Model, _msg: Msg, _u: Util<typeof params>): Model {
  return model;
}

const COLOURS = ["#1d2a44", "#b0563a", "#2f6b3a"] as const;

function strokes(v: View, brush: Style): Drawing {
  return COLOURS.map((stroke, i) => {
    const y = 85 + i * 70;
    return v.curve([[30, y + 10], [130, y - 20], [250, y + 18], [330, y - 6]], false, { ...brush, stroke });
  });
}

export function draw(v: View, _model: Model, p: ParamValues<typeof params>): RootDrawing {
  const brush: Style = { brush: p.brush, gesture: { pressure: p.pressure, wobble: p.wobble }, weight: p.weight };
  return v.group({ effects: { paper: p.paper } }, [
    v.background("#f4efe2"),
    strokes(v, brush),
    v.circle(400, 160, 46, { ...brush, stroke: "#6a3d7a", fill: "#eadfcf" }),
  ]);
}
