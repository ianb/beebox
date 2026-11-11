// Brush playground (TEA tier): pick a brush, width, pressure and wobble with the
// params and see a few strokes, a hatched shape and a soft glow drawn with it.
import type { DeepReadonly, Msg, ParamsDecl, ParamValues, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  brush: { type: "select", options: ["ink", "marker", "pencil", "chalk", "airbrush", "wash", "bristle"] as const, default: "bristle" },
  pressure: { type: "select", options: ["taper", "even", "swell", "press", "taper-out"] as const, default: "taper" },
  weight: { type: "number", min: 1, max: 60, step: 1, default: 18 },
  wobble: { type: "number", min: 0, max: 8, step: 0.5, default: 1.5 },
  paper: { type: "number", min: 0, max: 1, step: 0.05, default: 0.4 },
} as const satisfies ParamsDecl;

export const canvas = { width: 480, height: 320 };

export interface Model { readonly ticks: number }

export function init(_u: Util<typeof params>): Model {
  return { ticks: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util<typeof params>): Model {
  switch (msg.type) {
    case "tick":
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

export function draw(v: View, _model: DeepReadonly<Model>, p: ParamValues<typeof params>): void {
  v.background("#f4efe2");
  v.noFill();
  v.brush(p.brush);
  v.gesture({ pressure: p.pressure, wobble: p.wobble });
  v.strokeWeight(p.weight);
  const colors = ["#1d2a44", "#b0563a", "#2f6b3a"];
  for (const [i, c] of colors.entries()) {
    v.stroke(c);
    const y = 60 + i * 55;
    v.curve([
      [30, y + 10],
      [130, y - 20],
      [250, y + 18],
      [330, y - 6],
    ]);
  }
  const blob = v.curvePath(
    [
      [380, 200],
      [450, 190],
      [460, 270],
      [390, 290],
      [360, 250],
    ],
    true,
  );
  v.noStroke();
  v.fill(v.ellipseGradient(410, 240, 140, 100, [
    [0, "rgba(255,214,120,0.9)"],
    [1, "rgba(255,214,120,0)"],
  ]));
  v.ellipse(410, 240, 140, 100);
  v.clip(blob, () => {
    v.stroke("#3b4a8a");
    v.strokeWeight(Math.max(2, p.weight / 4));
    for (let i = 0; i < 14; i += 1) v.line(340 + i * 10, 300, 380 + i * 10, 180);
  });
  v.stroke("#1f2a1f");
  v.strokeWeight(3);
  v.brush("ink");
  v.path(blob);
  v.paperTexture(p.paper);
}
