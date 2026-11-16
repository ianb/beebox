import type { DeepReadonly, Msg, View, Util } from "@ianbicking/canvas-loop";

export const canvas = { width: 720, height: 450 };
export interface Model { frame: number }

export function init(): Model { return { frame: 0 }; }
export function update(model: DeepReadonly<Model>, msg: Msg, _u: Util): Model {
  switch (msg.type) {
    case "tick": return { frame: msg.frame };
    case "mousedown": case "mouseup": case "mousemove": case "keydown":
    case "keyup": case "param": case "trigger": return model;
  }
}

function vendor(v: View, coat: string, scarf: string, wave: boolean): void {
  // The same drawing is recorded in three colourways.
  v.ellipse(47, 126, 40, 13, { fill: "#382b37" });
  v.path([["move", 20, 119], ["quad", 17, 67, 36, 61], ["line", 61, 61],
    ["quad", 79, 78, 73, 119], ["close"]], { fill: coat, stroke: "#493643", weight: 2 });
  v.curve([[23, 78], [17, 92], [20, 111]], false,
    { stroke: coat, weight: 20, brush: "bristle", gesture: { seed: 15 } });
  v.curve(wave ? [[70, 76], [83, 48], [87, 35]] : [[70, 76], [77, 91], [68, 108]], false,
    { stroke: coat, weight: 18, brush: "bristle", gesture: { seed: 16 } });
  v.circle(wave ? 87 : 68, wave ? 34 : 108, 8, { fill: "#d9a27e" });
  v.ellipse(47, 44, 24, 27, { fill: "#d8a17d", stroke: "#745451", weight: 2 });
  v.ellipse(34, 45, 3, 4, { fill: "#392e36" });
  v.ellipse(56, 45, 3, 4, { fill: "#392e36" });
  v.curve([[40, 57], [47, 59], [54, 56]], false, { stroke: "#a65f58", weight: 2, brush: "ink" });
  v.curve([[23, 34], [26, 9], [45, 5], [66, 15], [70, 33]], false,
    { stroke: "#322e3b", weight: 14, brush: "bristle", gesture: { seed: 17 } });
  v.curve([[31, 67], [44, 72], [60, 67]], false,
    { stroke: scarf, weight: 11, brush: "bristle", gesture: { seed: 18 } });
}

function stall(v: View, x: number, awning: string, produce: string): void {
  v.group({ name: "painted stall", effects: { wash: { granulate: 0.55, blotch: 0.35, edges: 0.35 }, paper: 0.35 } }, () => {
    v.rect(x + 17, 169, 8, 204, { fill: "#745347" });
    v.rect(x + 189, 169, 8, 204, { fill: "#745347" });
    v.rect(x, 175, 218, 16, { fill: "#604a49" });
    v.path([["move", x - 5, 179], ["line", x + 222, 179], ["line", x + 204, 128],
      ["line", x + 14, 128], ["close"]], { fill: awning, stroke: "#634550", weight: 2 });
    for (let i = 0; i < 6; i += 1) {
      v.path([["move", x + 14 + i * 32, 129], ["line", x + 28 + i * 32, 129],
        ["line", x + 35 + i * 32, 179], ["line", x + 29 + i * 32, 179], ["close"]],
      { fill: "rgba(255,241,213,0.46)" });
    }
    v.rect(x - 3, 294, 222, 66, { fill: "#785447", stroke: "#493b3b", weight: 2 });
    v.rect(x + 5, 301, 207, 12, { fill: "#bd8d68" });
    for (let row = 0; row < 2; row += 1) for (let i = 0; i < 6; i += 1) {
      const px = x + 27 + i * 31 + (row % 2) * 11;
      const py = 280 - row * 17 + Math.sin(i * 4 + x) * 3;
      v.ellipse(px, py, 14, 10, { fill: produce, stroke: "#604b3d", weight: 1 });
      v.curve([[px, py - 7], [px + 2, py - 14], [px + 9, py - 12]], false,
        { stroke: "#56815c", weight: 3, brush: "bristle", gesture: { seed: i + row * 7 } });
    }
    for (let i = 0; i < 4; i += 1) v.line(x + 15, 326 + i * 8, x + 203, 326 + i * 8,
      { stroke: "rgba(239,195,139,0.28)", weight: 3, brush: "bristle", gesture: { seed: i } });
  });
}

export function draw(v: View, model: DeepReadonly<Model>): void {
  v.background("#e8d7ba");
  v.paper({ scale: 4, contrast: 0.65, seed: 19 });
  v.group({ name: "dusk sky", effects: { wash: { granulate: 0.5, blotch: 0.3, bleed: 3 }, paper: 0.5 } }, () => {
    v.rect(0, 0, 720, 269, { fill: v.linearGradient(0, 0, 0, 269,
      [[0, "#92869c"], [0.55, "#d3a49b"], [1, "#edd2ae"]]) });
    for (let i = 0; i < 8; i += 1) v.ellipse(i * 111 - 25, 223, 59, 34,
      { fill: i % 2 ? "#9d8991" : "#ac9290" });
    v.rect(0, 269, 720, 181, { fill: "#9a817b" });
    for (let i = 0; i < 13; i += 1) v.line(i * 67 - 30, 355, i * 67 + 60, 450,
      { stroke: "rgba(239,212,176,0.28)", weight: 8, brush: "bristle", gesture: { seed: i } });
  });
  const coats = ["#597e78", "#bf755d", "#7673a1"];
  const scarves = ["#d5b36a", "#ead0a1", "#b5c59d"];
  const produce = ["#d89259", "#c7615a", "#aba958"];
  for (let i = 0; i < 3; i += 1) {
    const x = 21 + i * 234;
    const breathing = Math.sin(model.frame / 16 + i * 1.5) * 1.5;
    const raised = i === 1 || (i === 0 && Math.sin(model.frame / 15) > 0);
    const figure = v.picture({ key: "vendor", width: 95, height: 130,
      deps: [coats[i], scarves[i], raised] },
      () => vendor(v, coats[i] ?? "#597e78", scarves[i] ?? "#d5b36a", raised));
    v.at({ translate: [x + 59, 166 + breathing] }, () => v.place(figure, 0, 0));
    stall(v, x, ["#9a6164", "#75817a", "#bb8e70"][i] ?? "#9a6164", produce[i] ?? "#d89259");
    v.text(["CITRUS", "APPLES", "PEARS"][i] ?? "", { x: x + 109, y: 344 },
      { font: "Georgia, serif", size: 16, style: "bold", fill: "#f5deb8", align: "center" });
  }
  // Lantern held above the centre vendor's raised hand.
  const lx = 21 + 234 + 59 + 87;
  const ly = 166 + Math.sin(model.frame / 16 + 1.5) * 1.5 + 35 - 17;
  v.group({ name: "lantern", lighting: { ambient: "#6b6577", shadows: "soft", exposure: 0.3, toneCurve: 0.45 },
    effects: { glow: { color: "#ffba66", blur: 22, strength: 3 } } }, () => {
    v.light({ kind: "point", at: [lx, ly], height: 65, reach: 145, color: "#ffd59b", energy: 1.8 });
    v.roundRect(lx - 10, ly - 12, 20, 27, 3, { fill: "#5e4650", stroke: "#efc576", weight: 2,
      material: { shine: 0.6, castsShadow: 20 } });
    v.ellipse(lx, ly, 6, 9, { fill: "#ffe8aa", material: { emissive: 1 },
      effects: { glow: { color: "#ffd273", blur: 14, strength: 3 } } });
    v.line(lx - 10, ly + 2, lx + 10, ly + 2, { stroke: "#ffcb83", weight: 2 });
  });
}
