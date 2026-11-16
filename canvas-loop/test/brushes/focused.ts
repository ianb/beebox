// Brushed contours at the edges of the contour contract
// (canvas-loop-gpu-brushes.subplan.md): shorter than one step, a closed
// rectangle, duplicate consecutive points, a closed polygon that already ends
// at its start, a length of 2.85 at step 0.3, every pressure form, wobble
// on open and closed contours, a rotated, scaled call, a sample at a corner,
// an empty contour, and a closed dot with wobble.
import type { View } from "../../src/core/tea.js";

export const FOCUSED_SIZE = { width: 200, height: 160 };

export function drawFocused(v: View): void {
  // Ink at weight 4 steps 0.667: 0.2 long is one sample (with wobble: it still moves).
  v.line(10, 10, 10.2, 10, { stroke: "#000", weight: 4, brush: "ink", gesture: { wobble: 1 } });
  v.rect(20, 20, 30, 15, { stroke: "#000", weight: 3, brush: "pencil", gesture: { wobble: 0 } });
  v.polygon([[60, 20], [60, 20], [90, 22], [80, 40], [80, 40], [80, 40]], { stroke: "#000", weight: 2, brush: "chalk" });
  v.polygon([[100, 20], [130, 25], [115, 45], [100, 20]], { stroke: "#000", weight: 2, brush: "ink", gesture: { wobble: 1.5 } });
  v.path([["move", 140, 20], ["line", 150, 30], ["line", 150, 30], ["line", 170, 20]], { stroke: "#000", weight: 2, brush: "ink" });
  // Pencil at weight 1 steps 0.3: 2.85 long gives 11 samples by the loop, 10 by ceil(total / step − 0.5) + 1.
  // (A translation leaves brush space alone; 12.85 − 10 would not be 2.85.)
  v.at({ translate: [10, 60] }, () => v.line(0, 0, 2.85, 0, { stroke: "#000", weight: 1, brush: "pencil", gesture: { wobble: 0 } }));
  const pressures = [0.4, "even", "taper", "taper-in", "taper-out", "swell", "press", [[0, 0.2], [0.5, 1], [0.5, 0.4], [1, 0.8]]] as const;
  for (const [i, pressure] of pressures.entries()) {
    v.curve([[20 + i * 20, 80], [28 + i * 20, 70], [36 + i * 20, 90]], false, { stroke: "#000", weight: 3, brush: "ink", gesture: { pressure, wobble: 0.8 } });
  }
  v.circle(40, 130, 18, { stroke: "#000", weight: 5, brush: "wash", gesture: { wobble: 2 } });
  v.at({ translate: [120, 120], rotate: 0.6, scale: 1.7 }, () => {
    v.curve([[-20, 0], [0, -15], [20, 5]], false, { stroke: "#000", weight: 2, brush: "bristle", gesture: { wobble: 1 } });
    v.ellipse(0, 10, 12, 5, { stroke: "#000", weight: 1.5, brush: "airbrush" });
  });
  // A sample exactly at a corner (1.8 = 6 × 0.3 on the CPU; f32 arithmetic lands past the f32 corner): it takes the incoming segment's normal.
  v.at({ translate: [150, 60] }, () => v.path([["move", 0, 0], ["line", 1.8, 0], ["line", 1.8, 3]], { stroke: "#000", weight: 1, brush: "pencil", gesture: { wobble: 1, seed: 42 } }));
  // No points: no samples, beside the others in one batch.
  v.polygon([], { stroke: "#000", weight: 1, brush: "pencil" });
  // A closed dot with wobble: one sample, its wobble read at 0.
  v.rect(170, 100, 0.1, 0.1, { stroke: "#000", weight: 4, brush: "ink", gesture: { wobble: 1 } });
}
