// Reference guide for the brush experiments: a friendly green alien in flat
// shapes. Clear form only — pose and proportion for a drawer to follow, not a
// finished illustration.
import type { Sketch } from "@ianbicking/canvas-loop";

const OUTLINE = "#1f2a1f";
const SKIN = "#7ccf6a";
const SKIN_SHADE = "#5fae50";

export function setup(s: Sketch): void {
  s.createCanvas(400, 500);
}

function antenna(s: Sketch, tip: readonly [number, number]): void {
  s.noFill();
  s.stroke(OUTLINE);
  s.strokeWeight(4);
  s.path([
    ["move", 200 + (tip[0] - 200) * 0.25, 120],
    ["quad", 200 + (tip[0] - 200) * 0.7, 80, tip[0], tip[1]],
  ]);
  s.fill("#f2d94e");
  s.strokeWeight(3);
  s.circle(tip[0], tip[1], 22);
}

function limbs(s: Sketch): void {
  s.fill(SKIN);
  s.stroke(OUTLINE);
  s.strokeWeight(3);
  // Left arm hangs; right arm waves.
  s.path([["move", 150, 290], ["quad", 105, 330, 112, 375], ["line", 132, 372], ["quad", 135, 335, 162, 315], ["close"]]);
  s.path([["move", 250, 292], ["quad", 315, 285, 336, 232], ["line", 316, 224], ["quad", 300, 262, 244, 270], ["close"]]);
  s.circle(122, 380, 26);
  s.circle(330, 222, 28);
  // Legs and feet.
  s.rect(165, 390, 26, 50);
  s.rect(209, 390, 26, 50);
  s.ellipse(172, 444, 48, 22);
  s.ellipse(228, 444, 48, 22);
}

export function draw(s: Sketch): void {
  s.background("#f4f1e8");
  s.noStroke();
  s.fill("#d9d3c3");
  s.ellipse(200, 452, 190, 28);

  antenna(s, [140, 40]);
  antenna(s, [262, 34]);
  limbs(s);

  // Body: a pear shape.
  s.fill(SKIN);
  s.stroke(OUTLINE);
  s.strokeWeight(3);
  s.path([
    ["move", 200, 240],
    ["bezier", 260, 240, 262, 330, 252, 380],
    ["bezier", 245, 405, 155, 405, 148, 380],
    ["bezier", 138, 330, 140, 240, 200, 240],
    ["close"],
  ]);
  s.noStroke();
  s.fill(SKIN_SHADE);
  s.ellipse(200, 345, 60, 70);

  // Head: wide oval.
  s.fill(SKIN);
  s.stroke(OUTLINE);
  s.strokeWeight(3);
  s.ellipse(200, 175, 210, 170);

  // Eyes, with highlights.
  s.fill("#ffffff");
  s.ellipse(160, 165, 52, 62);
  s.ellipse(240, 165, 52, 62);
  s.noStroke();
  s.fill(OUTLINE);
  s.circle(165, 172, 26);
  s.circle(235, 172, 26);
  s.fill("#ffffff");
  s.circle(170, 165, 8);
  s.circle(240, 165, 8);

  // Smile and cheeks.
  s.noFill();
  s.stroke(OUTLINE);
  s.strokeWeight(4);
  s.path([["move", 178, 215], ["quad", 200, 235, 222, 215]]);
  s.noStroke();
  s.fill("#e98f86");
  s.ellipse(132, 205, 22, 12);
  s.ellipse(268, 205, 22, 12);
}
