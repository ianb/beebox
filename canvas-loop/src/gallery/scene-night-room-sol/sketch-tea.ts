import type { DeepReadonly, Msg, SceneView as View, Util } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const canvas = { width: 700, height: 440 };
export interface Model { frame: number }
export function init(): Model { return { frame: 0 }; }
export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util): Model {
  switch (msg.type) {
    case "tick": return { frame: msg.frame };
    case "mousedown": case "mouseup": case "mousemove": case "keydown":
    case "keyup": case "param": case "trigger": return model;
  }
}

function room(v: View, frame: number): void {
  v.group({ name: "watercolour night room", lighting: {
    ambient: "#657087", shadows: "soft", exposure: 0.35, toneCurve: 0.75 },
    effects: { wash: { granulate: 0.56, blotch: 0.27, edges: 0.36, bleed: 2 }, paper: 0.42 } }, () => {
    v.rect(0, 0, 1020, 440, { fill: "#b09b9a" });
    v.rect(0, 0, 1020, 280, { fill: v.linearGradient(0, 0, 0, 280,
      [[0, "#76748e"], [1, "#b39998"]]) });
    v.rect(0, 283, 1020, 157, { fill: "#746975" });
    v.line(0, 281, 1020, 281, { stroke: "#ded1bf", weight: 7, brush: "bristle", gesture: { seed: 5 } });
    for (let i = 0; i < 12; i += 1) v.line(i * 92, 284, i * 73 - 50, 440,
      { stroke: "#92818a", weight: 2, brush: "pencil", gesture: { seed: i } });
    // A blue window and its moonlit pool.
    v.group({ name: "moonlit window", effects: { glow: { color: "#9ec9e4", blur: 35, strength: 2 } } }, () => {
      v.rect(185, 48, 177, 174, { fill: "#506b83", material: { emissive: 0.75 } });
      v.circle(293, 98, 27, { fill: "#f3e7c7", material: { emissive: 1 },
        effects: { glow: { color: "#d9e7ee", blur: 18 } } });
      v.curve([[202, 172], [244, 131], [281, 155], [336, 132], [350, 155]], false,
        { stroke: "#7895a2", weight: 32, brush: "wash", gesture: { seed: 11 } });
    });
    v.rect(180, 43, 187, 185, { stroke: "#3c4355", weight: 13, material: { castsShadow: 24 } });
    v.line(274, 46, 274, 220, { stroke: "#3c4355", weight: 10, material: { castsShadow: 24 } });
    v.line(185, 140, 360, 140, { stroke: "#3c4355", weight: 9, material: { castsShadow: 24 } });
    v.curve([[176, 44], [207, 72], [209, 143], [178, 224]], false,
      { stroke: "#aa8b93", weight: 31, brush: "bristle", gesture: { seed: 12 } });
    v.curve([[369, 44], [339, 74], [342, 146], [370, 224]], false,
      { stroke: "#aa8b93", weight: 31, brush: "bristle", gesture: { seed: 13 } });
    // Bookshelf, books, and its long shadow.
    v.rect(14, 116, 132, 184, { fill: "#604d55", material: { bevel: 7, relief: 0.35, castsShadow: 65 } });
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const y = 148 + shelf * 50;
      v.rect(20, y + 30, 119, 8, { fill: "#ba947c", material: { castsShadow: 17 } });
      for (let j = 0; j < 8; j += 1) v.rect(25 + j * 14, y - 4 + (j % 3) * 4, 10, 34 - (j % 3) * 4,
        { fill: ["#aa7779", "#718c8a", "#c4a374", "#787895"][j % 4] ?? "#aa7779" });
    }
    // Table with legs; everything within this lit group can cast shadows.
    v.ellipse(602, 355, 169, 26, { fill: "rgba(54,47,65,0.23)" });
    v.rect(488, 270, 16, 105, { fill: "#6c5054", material: { castsShadow: 49 } });
    v.rect(701, 270, 16, 105, { fill: "#6c5054", material: { castsShadow: 49 } });
    v.roundRect(467, 255, 276, 32, 7, { fill: "#9d7568", stroke: "#503d48", weight: 2,
      material: { bevel: 5, relief: 0.45, shine: 0.15, castsShadow: 54 } });
    v.ellipse(606, 248, 55, 11, { fill: "#bc9b78" });
    v.ellipse(606, 241, 51, 9, { fill: "#d1b49b" });
    v.circle(582, 237, 8, { fill: "#b26a5c" });
    v.circle(603, 232, 9, { fill: "#c8ad67" });
    v.circle(626, 239, 8, { fill: "#8a9e6b" });
    // Seated reader; hands and face stay warm under the lamp.
    v.ellipse(792, 361, 65, 19, { fill: "rgba(44,42,61,0.35)" });
    v.rect(767, 245, 78, 119, { fill: "#796d81", material: { castsShadow: 74 } });
    v.curve([[754, 293], [772, 281], [824, 284], [849, 303], [839, 353], [767, 356]], true,
      { fill: "#6b7a80", stroke: "#454957", weight: 2, material: { castsShadow: 58 } });
    v.curve([[769, 304], [756, 335], [779, 361]], false,
      { stroke: "#3e4553", weight: 22, brush: "bristle", gesture: { seed: 21 } });
    v.ellipse(795, 259, 24, 30, { fill: "#c49482", material: { bevel: 4, relief: 0.25 } });
    v.curve([[772, 251], [778, 227], [804, 225], [819, 250]], false,
      { stroke: "#3f3b4b", weight: 14, brush: "bristle", gesture: { seed: 22 } });
    v.line(790, 262, 795, 263, { stroke: "#3d3c4a", weight: 2 });
    v.curve([[786, 313], [817, 322], [853, 310]], false,
      { stroke: "#ba8d7d", weight: 14, brush: "bristle", gesture: { seed: 23 } });
    v.path([["move", 818, 290], ["line", 857, 284], ["line", 852, 326], ["line", 819, 331], ["close"]],
      { fill: "#e0c8ac", stroke: "#6c5d64", weight: 2 });
    // Ceiling lamp, with noise-driven flicker.
    const flicker = 0.68 + v.noise(frame * 0.16, 8) * 0.28;
    v.light({ kind: "point", at: [610, 138], height: 75, reach: 420,
      color: "#ffd2a0", energy: 1.4 * flicker });
    v.light({ kind: "point", at: [275, 143], height: 90, reach: 300,
      color: "#9cc3eb", energy: 0.8 });
    v.line(610, 0, 610, 109, { stroke: "#443d4d", weight: 3 });
    v.path([["move", 580, 109], ["quad", 610, 90, 641, 109],
      ["line", 652, 134], ["quad", 611, 149, 569, 134], ["close"]],
      { fill: "#b28882", stroke: "#4d4352", weight: 3, material: { castsShadow: 23 } });
    v.ellipse(611, 135, 17, 5, { fill: "#ffe9bc", material: { emissive: flicker },
      effects: { glow: { color: "#ffd49e", blur: 21, strength: 2.5 * flicker } } });
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#ddd1c2");
  v.paper({ scale: 4, contrast: 0.57, seed: 81 });
  const pan = 24 + model.frame * 2.5;
  v.at({ translate: [-pan, 0] }, () => room(v, model.frame));
  v.rect(0, 0, 700, 440, { fill: v.radialGradient(350, 210, 525,
    [[0, "rgba(25,20,39,0)"], [1, "rgba(25,20,39,0.28)"]]) });
}
