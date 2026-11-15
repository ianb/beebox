// Many small things that all move: no pictures (nothing repeats), additive
// light. Shows the case where the scene is rebuilt every frame; the renderer
// must keep that cheap (Stage 3 measures it).
import type { View } from "./scene-api.js";

export function draw(v: View, model: { sparks: readonly { readonly x: number; readonly y: number; readonly life: number }[] }): void {
  v.background("#0b0b14");
  v.group({ blend: "add" }, () => {
    for (const s of model.sparks) v.circle(s.x, s.y, 2 + 4 * s.life, { fill: v.radialGradient(s.x, s.y, 2 + 4 * s.life, [[0, "rgba(255,210,120,0.9)"], [1, "rgba(255,120,40,0)"]]) });
  });
}
