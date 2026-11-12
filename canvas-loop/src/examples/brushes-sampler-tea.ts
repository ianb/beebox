// Brush sampler: every preset with two gestures, plus a small-shape row.
// Renders the reference images for BRUSHES.md.
import type {
  BrushName,
  DeepReadonly,
  Msg,
  Style,
  Util,
  View,
} from "@ianbicking/canvas-loop";

const PRESETS: [BrushName, string, number][] = [
  ["ink", "#1d2a44", 6],
  ["marker", "#e0517a", 16],
  ["pencil", "#2a2c30", 4],
  ["chalk", "#3b6fb6", 12],
  ["airbrush", "#7a3fb0", 30],
  ["wash", "#2f7d8c", 34],
  ["bristle", "#2f6b3a", 26],
];

export const canvas = { width: 640, height: 70 * PRESETS.length + 20 };

export type Model = Record<string, never>;

export function init(_u: Util): Model {
  return {};
}

export function update(model: DeepReadonly<Model>, _msg: Msg): Model {
  return model;
}

export function draw(v: View, _model: DeepReadonly<Model>): void {
  v.background("#f6f2e7");
  for (const [i, [name, color, weight]] of PRESETS.entries()) {
    const y = 45 + i * 70;
    v.text(
      name,
      { x: 16, y: y + 4 },
      { size: 13, fill: "#555555", valign: "baseline" },
    );
    const brushed: Style = { stroke: color, weight, brush: name };
    v.curve(
      [
        [100, y + 10],
        [180, y - 14],
        [270, y + 12],
        [360, y - 8],
      ],
      false,
      { ...brushed, gesture: { pressure: "taper", wobble: 1.5 } },
    );
    v.line(400, y, 520, y, { ...brushed, gesture: { pressure: "press" } });
    // Small shapes: a dot-sized circle and a short dab.
    const small: Style = { ...brushed, gesture: { pressure: "even" } };
    v.circle(560, y, 18, small);
    v.line(595, y - 10, 615, y + 10, small);
  }
}
