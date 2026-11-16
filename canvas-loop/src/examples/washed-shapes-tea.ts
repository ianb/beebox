// Flat shapes and brushed strokes, with and without a watercolour wash
// (draft effects.wash): the look round's test for pooling, blooms, drying
// edges and faint granulation.
import type { Msg, ParamsDecl, ParamValues, View } from "@ianbicking/canvas-loop";

/** Draws with the scene View on the GPU renderer (`cli run` reads this). */
export const renderer = "scene";

export const params = {
  look: { type: "select", options: ["plain", "wash"], default: "wash", label: "Look" },
} as const satisfies ParamsDecl;

export const canvas = { width: 640, height: 480 };

export function init(): { frame: number } {
  return { frame: 0 };
}
export function update(model: { frame: number }, msg: Msg): { frame: number } {
  return msg.type === "tick" ? { frame: msg.frame } : model;
}

function shapes(v: View): void {
  v.rect(40, 40, 260, 180, { fill: "#4f78a8" });
  v.circle(380, 150, 90, { fill: "#e0913a" });
  v.triangle(60, 420, 200, 260, 330, 430, { fill: "#4f8a4f" });
  v.curve([[360, 300], [470, 255], [600, 300], [610, 420], [470, 465], [365, 420]], true, { fill: "#b8394f" });
  v.curve([[60, 245], [160, 190], [260, 240], [400, 225], [600, 260]], false, { stroke: "#2a2a2a", weight: 6, brush: "pencil" });
  v.curve([[80, 460], [220, 380], [360, 470], [600, 390]], false, { stroke: "#3a4fa0", weight: 14, brush: "wash" });
}

export function draw(v: View, _model: { frame: number }, p: ParamValues<typeof params>): void {
  v.background("#f4efe4");
  if (p.look === "wash") v.group({ effects: { wash: { granulate: 0.5, edges: 0.6, blotch: 0.5, bleed: 2 } } }, () => shapes(v));
  else shapes(v);
}
