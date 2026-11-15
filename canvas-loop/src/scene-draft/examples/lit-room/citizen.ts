// A reusable character drawn with brushes, placed three times. Shows: a
// component as a plain function, a picture memoised on its look (not on the
// animation frame), a glow on one stroke, and per-instance placement.
import type { Picture, View } from "../../scene-api.js";

export interface Look {
  readonly suit: string;
  readonly hair: string;
  readonly number: string;
}

/** The citizen's body, standing, in its own 0..120 × 0..260 coordinates. */
function body(v: View, look: Look): void {
  const ink = { stroke: "#241c17", weight: 2.2, brush: "ink", gesture: { wobble: 0.8, seed: 7 } } as const;
  v.roundRect(30, 90, 60, 110, 18, { fill: look.suit, ...ink });
  v.text(look.number, { x: 60, y: 130 }, { size: 14, fill: "#f0e8d0", align: "center", style: "bold" });
  v.circle(60, 60, 26, { fill: "#c58a62", ...ink });
  v.curve([[36, 52], [50, 30], [76, 32], [86, 52]], false, { stroke: look.hair, weight: 10, brush: "bristle" });
  // The badge glows: an effect on this one stroke, nothing else.
  v.circle(44, 104, 5, { fill: "#ffd27a", effects: { glow: { blur: 6, color: "#ffd27a" } } });
}

/** One recording per distinct look; animation does not re-record it. */
export function citizenPicture(v: View, look: Look): Picture {
  return v.picture({ key: "citizen", deps: [look.suit, look.hair, look.number], width: 120, height: 260 }, () => body(v, look));
}

export function draw(v: View, model: { frame: number }): void {
  v.background("#d8ccb0");
  const looks: readonly Look[] = [
    { suit: "#3a6a9a", hair: "#2e1d15", number: "B3" },
    { suit: "#8a3a2a", hair: "#a04a20", number: "R7" },
    { suit: "#3a6a9a", hair: "#2e1d15", number: "B3" }, // same look: same recording
  ];
  for (const [i, look] of looks.entries()) {
    const bob = Math.sin(model.frame / 20 + i) * 3;
    v.at({ translate: [80 + i * 160, 120 + bob] }, () => v.place(citizenPicture(v, look), 0, 0));
  }
}
