// Smudge and wet strokes for the GPU `smears` entry (canvas-loop-gpu-brushes.subplan.md,
// chunk 8): the smear sheet with a rotated, scaled, wobbled smudge and a wet
// stroke of two contours (one a single sample) added.
import type { View } from "../../src/core/tea.js";
import { drawSmear } from "./brush-sheet.js";

export const SMEARS_SIZE = { width: 320, height: 160 };

export function drawSmears(v: View): void {
  drawSmear(v);
  v.at({ translate: [160, 80], rotate: 0.4, scale: [1.3, 0.8] }, () => v.curve([[-60, 0], [0, 12], [60, -6]], false, { stroke: "#000", weight: 10, brush: "smudge", gesture: { wobble: 1.5 } }));
  v.path([["move", 40, 140], ["line", 40, 140], ["move", 60, 140], ["line", 200, 150]], { stroke: "#f2f2f2", weight: 8, brush: "wet" });
}
