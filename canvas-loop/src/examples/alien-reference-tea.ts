// Reference guide for the brush experiments: a friendly green alien in flat
// shapes. Clear form only — pose and proportion for a drawer to follow, not a
// finished illustration.
import type {
  DeepReadonly,
  Msg,
  Style,
  Util,
  View,
} from "@ianbicking/canvas-loop";

export const canvas = { width: 400, height: 500 };

const OUTLINE = "#1f2a1f";
const SKIN = "#7ccf6a";
const SKIN_SHADE = "#5fae50";

const LINE_4: Style = { stroke: OUTLINE, weight: 4 };
const SKIN_OUTLINED: Style = { fill: SKIN, stroke: OUTLINE, weight: 3 };

export type Model = Record<string, never>;

export function init(_u: Util): Model {
  return {};
}

export function update(model: DeepReadonly<Model>, _msg: Msg): Model {
  return model;
}

function antenna(v: View, tip: readonly [number, number]): void {
  v.path(
    [
      ["move", 200 + (tip[0] - 200) * 0.25, 120],
      ["quad", 200 + (tip[0] - 200) * 0.7, 80, tip[0], tip[1]],
    ],
    LINE_4,
  );
  v.circle(tip[0], tip[1], 11, { fill: "#f2d94e", stroke: OUTLINE, weight: 3 });
}

function limbs(v: View): void {
  // Left arm hangs; right arm waves.
  v.path(
    [
      ["move", 150, 290],
      ["quad", 105, 330, 112, 375],
      ["line", 132, 372],
      ["quad", 135, 335, 162, 315],
      ["close"],
    ],
    SKIN_OUTLINED,
  );
  v.path(
    [
      ["move", 250, 292],
      ["quad", 315, 285, 336, 232],
      ["line", 316, 224],
      ["quad", 300, 262, 244, 270],
      ["close"],
    ],
    SKIN_OUTLINED,
  );
  v.circle(122, 380, 13, SKIN_OUTLINED);
  v.circle(330, 222, 14, SKIN_OUTLINED);
  // Legs and feet.
  v.rect(165, 390, 26, 50, SKIN_OUTLINED);
  v.rect(209, 390, 26, 50, SKIN_OUTLINED);
  v.ellipse(172, 444, 24, 11, SKIN_OUTLINED);
  v.ellipse(228, 444, 24, 11, SKIN_OUTLINED);
}

export function draw(v: View, _model: DeepReadonly<Model>): void {
  v.background("#f4f1e8");
  v.ellipse(200, 452, 95, 14, { fill: "#d9d3c3" });

  antenna(v, [140, 40]);
  antenna(v, [262, 34]);
  limbs(v);

  // Body: a pear shape.
  v.path(
    [
      ["move", 200, 240],
      ["bezier", 260, 240, 262, 330, 252, 380],
      ["bezier", 245, 405, 155, 405, 148, 380],
      ["bezier", 138, 330, 140, 240, 200, 240],
      ["close"],
    ],
    SKIN_OUTLINED,
  );
  v.ellipse(200, 345, 30, 35, { fill: SKIN_SHADE });

  // Head: wide oval.
  v.ellipse(200, 175, 105, 85, SKIN_OUTLINED);

  // Eyes, with highlights.
  const eyeWhite: Style = { fill: "#ffffff", stroke: OUTLINE, weight: 3 };
  v.ellipse(160, 165, 26, 31, eyeWhite);
  v.ellipse(240, 165, 26, 31, eyeWhite);
  v.circle(165, 172, 13, { fill: OUTLINE });
  v.circle(235, 172, 13, { fill: OUTLINE });
  v.circle(170, 165, 4, { fill: "#ffffff" });
  v.circle(240, 165, 4, { fill: "#ffffff" });

  // Smile and cheeks.
  v.path(
    [
      ["move", 178, 215],
      ["quad", 200, 235, 222, 215],
    ],
    LINE_4,
  );
  v.ellipse(132, 205, 11, 6, { fill: "#e98f86" });
  v.ellipse(268, 205, 11, 6, { fill: "#e98f86" });
}
