// Brush sampler: every preset with two gestures, plus a small-shape row.
// Renders the reference images for BRUSHES.md.
import type { BrushName, Sketch } from "@ianbicking/canvas-loop";

const PRESETS: [BrushName, string, number][] = [
  ["ink", "#1d2a44", 6],
  ["marker", "#e0517a", 16],
  ["pencil", "#2a2c30", 4],
  ["chalk", "#3b6fb6", 12],
  ["airbrush", "#7a3fb0", 30],
  ["wash", "#2f7d8c", 34],
  ["bristle", "#2f6b3a", 26],
];

export function setup(s: Sketch): void {
  s.createCanvas(640, 70 * PRESETS.length + 20);
}

export function draw(s: Sketch): void {
  s.background("#f6f2e7");
  for (const [i, [name, color, weight]] of PRESETS.entries()) {
    const y = 45 + i * 70;
    s.noBrush();
    s.noStroke();
    s.fill("#555555");
    s.textSize(13);
    s.text(name, 16, y + 4);
    s.noFill();
    s.stroke(color);
    s.strokeWeight(weight);
    s.brush(name);
    s.gesture({ pressure: "taper", wobble: 1.5 });
    s.curve([[100, y + 10], [180, y - 14], [270, y + 12], [360, y - 8]]);
    s.gesture({ pressure: "press" });
    s.line(400, y, 520, y);
    // Small shapes: a dot-sized circle and a short dab.
    s.gesture({ pressure: "even" });
    s.circle(560, y, 18);
    s.line(595, y - 10, 615, y + 10);
  }
}
