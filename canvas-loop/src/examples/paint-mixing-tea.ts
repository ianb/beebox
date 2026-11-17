// Colour jitter, smudge, wet paint and paper in one small landscape. Smudge
// and wet paint move paint already drawn, so they come after what they mix
// with: zigzag smudges soften the seam between the sky's two bands, and a wet
// yellow glaze mixes into the orange. The hills and grass jitter each
// bristle's and dab's colour. Linked from BRUSHES.md "Colour variation",
// "Smudge and wet paint" and "Paper".
import type { Drawing, Msg, RootDrawing, Style, Util, Vec2, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 420, height: 280 };

type Model = Record<string, never>;

export function init(_u: Util): Model {
  return {};
}

export function update(model: Model, _msg: Msg, _u: Util): Model {
  return model;
}

const SMUDGE: Style = { stroke: "#000000", weight: 18, brush: "smudge", gesture: { pressure: "even" } };
const GLAZE: Style = { stroke: "#f6c445", weight: 30, brush: { preset: "wet", opacity: 0.7 }, gesture: { pressure: "swell" } };
const HILL: Style = { stroke: "#4f7a3a", weight: 30, brush: { preset: "bristle", hueJitter: 14, lightJitter: 0.1 } };
const GRASS: Style = { stroke: "#7aa346", weight: 5, brush: { preset: "pencil", hueJitter: 18, lightJitter: 0.15 } };

// One long zigzag along the seam, uneven so it does not read as a pattern.
const SEAM = Array.from({ length: 60 }, (_, i): Vec2 => [i * 7.5 - 10 + 3 * Math.sin(i * 2.3), 100 + (i % 2 === 0 ? -1 : 1) * (8 + 5 * Math.sin(i * 0.9))]);
const RIDGE: readonly Vec2[] = [[-20, 200], [80, 168], [170, 190], [260, 160], [340, 185], [440, 170]];
const BLADES = Array.from({ length: 40 }, (_, i) => ({ x: 6 + i * 10.5, lean: ((i * 7) % 5) - 2, top: 250 - (i % 4) * 5 }));

function sky(v: View): Drawing {
  return [
    v.rect(0, 0, 420, 100, { fill: "#2f5b9a" }),
    v.rect(0, 100, 420, 120, { fill: "#e0855a" }),
    v.curve(SEAM, false, SMUDGE),
    v.circle(310, 140, 18, { fill: "#fbe3a1" }),
    // A wet glaze along the horizon mixes yellow into the orange and the blue edge.
    v.curve([[180, 150], [300, 128], [420, 138]], false, GLAZE),
  ];
}

function hills(v: View): Drawing {
  return [
    v.polygon([...RIDGE, [440, 280], [-20, 280]], { fill: "#3d6230" }),
    [0, 1, 2].map((row) => v.curve(RIDGE.map(([x, y]): Vec2 => [x, y + 6 + row * 16]), false, HILL)),
    BLADES.map((b) => v.line(b.x, 276, b.x + b.lean * 3, b.top, GRASS)),
  ];
}

export function draw(v: View, _model: Model): RootDrawing {
  return v.paper({ scale: 3, contrast: 0.6 }, [
    v.background("#f3ede0"),
    sky(v),
    hills(v),
  ]);
}
