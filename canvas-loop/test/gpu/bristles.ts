// Bristle strokes for the GPU `bristles` entry (canvas-loop-gpu-brushes.subplan.md,
// chunk 7): a plain stroke, a closed loop, sharp corners (mitres), a dry stroke
// whose bristles skip, one bristle and 64, no spread and full spread, wobble,
// a rotation and a non-uniform scale, a one-sample dot (alone and beside a
// longer contour), and hue and light jitter on colours where the HSL conversion
// has edge cases (grey, a hue near 0°/360°, near white and black).
import type { Drawing, View } from "../../src/core/tea.js";

export const BRISTLES_SIZE = { width: 360, height: 300 };

export function drawBristles(v: View): Drawing {
  return [
    v.curve([[20, 30], [80, 12], [140, 40], [200, 22]], false, { stroke: "#1d2a44", weight: 14, brush: "bristle" }),
    v.circle(270, 45, 28, { stroke: "#b0563a", weight: 10, brush: "bristle" }),
    v.path([["move", 20, 80], ["line", 60, 110], ["line", 100, 78], ["line", 104, 120], ["line", 150, 84]], { stroke: "#2f6b3a", weight: 12, brush: "bristle", gesture: { pressure: "even" } }),
    v.line(170, 100, 340, 100, { stroke: "#333", weight: 16, brush: { preset: "bristle", load: 0.15 }, gesture: { pressure: "even" } }),
    v.line(20, 140, 160, 150, { stroke: "#3b5d8a", weight: 8, brush: { preset: "bristle", bristles: 1, spread: 0 } }),
    v.line(180, 140, 340, 150, { stroke: "#3b5d8a", weight: 20, brush: { preset: "bristle", bristles: 64, spread: 1 }, gesture: { wobble: 2 } }),
    v.at({ translate: [90, 200], rotate: 0.5, scale: [1.6, 0.6] }, v.curve([[-50, 0], [0, 20], [50, -10]], false, { stroke: "#6a3b7a", weight: 14, brush: "bristle", gesture: { wobble: 1 } })),
    v.line(200, 190, 200, 190, { stroke: "#000", weight: 10, brush: "bristle" }),
    v.path([["move", 230, 190], ["line", 230, 190], ["move", 250, 180], ["line", 330, 200]], { stroke: "#000", weight: 10, brush: "bristle" }),
  ];
}

export function drawBristleJitter(v: View): Drawing {
  const out: Drawing[] = [];
  const colours = ["#c0392b", "#808080", "#ff0010", "#f2f0ff", "#0a0a14", "#2f6b3a"];
  for (const [i, stroke] of colours.entries()) {
    const y = 20 + i * 40;
    out.push(v.curve([[20, y], [90, y - 10], [170, y + 8]], false, { stroke, weight: 14, brush: { preset: "bristle", hueJitter: 40, lightJitter: 0.25 } }));
    out.push(v.curve([[190, y], [260, y + 8], [340, y - 6]], false, { stroke, weight: 10, brush: { preset: "bristle", hueJitter: 180, lightJitter: 1 } }));
  }
  out.push(v.line(30, 270, 30, 270, { stroke: "#c0392b", weight: 12, brush: { preset: "bristle", hueJitter: 90, lightJitter: 0.4 } }));
  return out;
}
