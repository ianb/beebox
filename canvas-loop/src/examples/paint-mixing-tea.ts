// Colour variation, smudge and wet paint in one small landscape:
//
//   - the sky is two flat bands, softened where they meet by one `smudge`
//     stroke that zigzags along the seam
//   - a `wet` glaze of yellow mixes into the sky near the sun
//   - the hills are `bristle` strokes with `hueJitter` and `lightJitter`, so
//     each bristle carries its own shade of green
//   - the grass is `pencil` with colour jitter
//
// Smudge and wet paint move paint already drawn, so they come after what they
// mix with. `draw` only paints; `update` only counts frames. See BRUSHES.md.
import type { DeepReadonly, Msg, Style, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 420, height: 280 };

export interface Model {
  frame: number;
}

export function init(_u: Util): Model {
  return { frame: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util): Model {
  return msg.type === "tick" ? { frame: model.frame + 1 } : { ...model };
}

const SMUDGE: Style = { stroke: "#000000", weight: 18, brush: "smudge", gesture: { pressure: "even" } };
const GLAZE: Style = { stroke: "#f6c445", weight: 30, brush: { preset: "wet", opacity: 0.7 }, gesture: { pressure: "swell" } };
const HILL: Style = { stroke: "#4f7a3a", weight: 30, brush: { preset: "bristle", hueJitter: 14, lightJitter: 0.1 } };
const GRASS: Style = { stroke: "#7aa346", weight: 5, brush: { preset: "pencil", hueJitter: 18, lightJitter: 0.15 } };

function sky(v: View): void {
  v.rect(0, 0, 420, 100, { fill: "#2f5b9a" });
  v.rect(0, 100, 420, 120, { fill: "#e0855a" });
  // Low zigzag strokes along the seam pull each band into the other.
  for (const [dy, phase] of [[-6, 0], [6, 1], [0, 0]] as const) {
    const zigzag: Vec2[] = Array.from({ length: 46 }, (_, i): Vec2 => [i * 10 - 10, 100 + dy + ((i + phase) % 2 === 0 ? -9 : 9)]);
    v.curve(zigzag, false, SMUDGE);
  }
  v.circle(310, 140, 36, { fill: "#fbe3a1" });
  // A wet glaze along the horizon mixes yellow into the orange and the blue edge.
  v.curve([[180, 150], [300, 128], [420, 138]], false, GLAZE);
}

function hills(v: View): void {
  const ridge: Vec2[] = [[-20, 200], [80, 168], [170, 190], [260, 160], [340, 185], [440, 170]];
  v.polygon([...ridge, [440, 280], [-20, 280]], { fill: "#3d6230" });
  for (let row = 0; row < 3; row += 1) {
    v.curve(ridge.map(([x, y]): Vec2 => [x, y + 6 + row * 16]), false, HILL);
  }
  for (let i = 0; i < 40; i += 1) {
    const x = 6 + i * 10.5;
    const lean = ((i * 7) % 5) - 2;
    v.line(x, 276, x + lean * 3, 250 - (i % 4) * 5, GRASS);
  }
}

export function draw(v: View, _model: DeepReadonly<Model>): void {
  v.paper({ scale: 3, contrast: 0.6 });
  v.background("#f3ede0");
  sky(v);
  hills(v);
}
