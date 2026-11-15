// A screen seen at an angle, glowing. Shows `at` with skew (what used to need
// v.ctx.transform), text under the same transform, and an emissive material
// that a lit group leaves bright.
import type { View } from "../scene-api.js";

export function draw(v: View, model: { frame: number }): void {
  v.background("#14110e");
  v.group({ lighting: { ambient: "#202028" } }, () => {
    v.at({ translate: [120, 80], skew: [0, -0.25] }, () => {
      v.rect(0, 0, 200, 120, { fill: "#0d2a1c", stroke: "#3a3a3a", weight: 6, material: { emissive: 1 } });
      const line = "PRODUCTIVITY ".repeat(3).slice(model.frame % 13);
      v.text(line, { x: 10, y: 50, w: 180, h: 20 }, { size: 14, fill: "#7ad8a0", font: "monospace" });
    });
    v.light({ kind: "point", at: [220, 140], height: 30, color: "#7ad8a0", energy: 0.5, reach: 200 });
  });
}
