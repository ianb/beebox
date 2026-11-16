// Stamp strokes for the GPU `dabs` entry (canvas-loop-gpu-brushes.subplan.md,
// chunk 3): hue and light jitter on every tip and on colours where the HSL
// conversion has edge cases (grey, a hue near 0°/360°, near white and black),
// under a rotation and a non-uniform scale; dabs the stamp rule skips (alpha 0 at
// zero pressure, radii falling through 0.05); and the extremes of scatter,
// sizeJitter and wobble, for the mark's box.
import type { View } from "../../src/core/tea.js";

export const STAMPS_SIZE = { width: 320, height: 240 };

export function drawJitter(v: View): void {
  const colours = ["#c0392b", "#808080", "#ff0010", "#f2f0ff", "#0a0a14", "#2f6b3a"];
  for (const [i, stroke] of colours.entries()) {
    const y = 20 + i * 18;
    v.curve([[20, y], [70, y - 8], [130, y + 6]], false, { stroke, weight: 10, brush: { preset: "chalk", hueJitter: 40, lightJitter: 0.25 } });
    v.curve([[150, y], [200, y + 6], [240, y - 4]], false, { stroke, weight: 3, brush: { preset: "pencil", hueJitter: 180, lightJitter: 1 } });
  }
  v.at({ translate: [260, 60], rotate: 0.7 }, () => v.circle(0, 0, 30, { stroke: "rgba(40, 90, 160, 0.6)", weight: 16, brush: { preset: "airbrush", hueJitter: 12, lightJitter: 0.1 } }));
  // Zero pressure at the ends: alpha 0 there. A pressure ramp from 0: radii from 0 up through 0.05.
  v.curve([[20, 200], [60, 190], [100, 205]], false, { stroke: "#333", weight: 6, brush: { preset: "chalk", opacityByPressure: 1, hueJitter: 10 }, gesture: { pressure: [[0, 0], [0.3, 1], [0.7, 1], [1, 0]] } });
  v.line(20, 225, 100, 225, { stroke: "#333", weight: 0.8, brush: { preset: "pencil", sizeByPressure: 1, lightJitter: 0.1 }, gesture: { pressure: [[0, 0], [1, 1]] } });
  v.at({ translate: [80, 160], scale: [1.8, 0.7] }, () => v.curve([[0, 0], [40, 30], [90, 0]], false, { stroke: "#6a7d4a", weight: 18, brush: { preset: "wash", hueJitter: 25, lightJitter: 0.15 }, gesture: { wobble: 2 } }));
}

export function drawExtremes(v: View): void {
  const wide = { scatter: 10, sizeJitter: 1, sizeByPressure: 0 } as const;
  v.curve([[60, 60], [120, 40], [180, 70]], false, { stroke: "#000", weight: 8, brush: { preset: "chalk", ...wide }, gesture: { wobble: 12 } });
  v.circle(160, 160, 20, { stroke: "#000", weight: 6, brush: { preset: "airbrush", ...wide }, gesture: { wobble: 20 } });
  v.at({ translate: [250, 150], rotate: -0.4, scale: 1.5 }, () => v.line(-20, 0, 20, 0, { stroke: "#000", weight: 4, brush: { preset: "pencil", ...wide }, gesture: { wobble: 8, pressure: "swell" } }));
}
