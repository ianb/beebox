// Paint pushed around. Shows the backdrop rule: a smudge reads what was drawn
// before it inside its nearest isolated group, never outside it. Here the sky
// and the smudge share a group, so the smudge drags sky colour; the sign
// drawn after the group is untouched.
import type { View } from "./scene-api.js";

export function draw(v: View): void {
  v.background("#f4ecd8");
  v.group({}, () => {
    v.rect(0, 0, 400, 150, { fill: v.linearGradient(0, 0, 0, 150, [[0, "#3a6a9a"], [1, "#e8b06a"]]) });
    v.curve([[20, 60], [140, 90], [300, 70], [380, 110]], false, { stroke: "#000", weight: 30, brush: "smudge" });
  });
  v.rect(150, 160, 100, 40, { fill: "#8a3a2a", stroke: "#241c17", weight: 2, brush: "ink" });
}
