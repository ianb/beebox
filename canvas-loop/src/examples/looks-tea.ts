// Wash and hatching on one still life: wash wants fields of colour, hatching
// wants a range of tone. Each object is a flat colour lit from the left, from
// highlight to core shadow, so the scene gives both looks what they need.
// Linked from BRUSHES.md "Effects".
import type { Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

export const params = {
  look: { type: "select", options: ["plain", "wash", "hatching"], default: "wash", label: "Look" },
} as const satisfies ParamsDecl;

export const canvas = { width: 560, height: 380 };

type Model = Record<string, never>;

export function init(_u: Util<typeof params>): Model {
  return {};
}

export function update(model: Model, _msg: Msg, _u: Util<typeof params>): Model {
  return model;
}

const TABLE = 262;

/** A left-lit fill across [x0, x1]: highlight, the colour, then its shadow. */
function lit(v: View, at: { x0: number; x1: number }, tones: readonly [string, string, string]): ReturnType<View["linearGradient"]> {
  return v.linearGradient(at.x0, 0, at.x1, 0, [[0, tones[0]], [0.35, tones[1]], [1, tones[2]]]);
}

function scene(v: View): Drawing[] {
  return [
    v.rect(0, 0, 560, TABLE, { fill: lit(v, { x0: 0, x1: 560 }, ["#efe6d2", "#d9cdb4", "#9c917c"]) }),
    v.rect(0, TABLE, 560, 120, { fill: lit(v, { x0: 0, x1: 560 }, ["#c98f5a", "#a8703f", "#6b4426"]) }),
    // Cast shadows fall to the right, on the table.
    v.group({ effects: { blur: 4 } }, [
      v.ellipse(205, 284, 70, 12, { fill: "rgba(50,30,15,0.55)" }),
      v.ellipse(372, 282, 64, 11, { fill: "rgba(50,30,15,0.55)" }),
      v.ellipse(470, 290, 34, 8, { fill: "rgba(50,30,15,0.55)" }),
    ]),
    // A blue mug: body, rim and handle.
    v.path([["move", 110, 140], ["quad", 96, 200, 120, 276], ["line", 220, 276], ["quad", 244, 200, 230, 140], ["close"]], { fill: lit(v, { x0: 100, x1: 240 }, ["#9cc0e6", "#3f6fa8", "#1b3156"]) }),
    v.ellipse(170, 140, 60, 10, { fill: "#20365c" }),
    v.path([["move", 228, 160], ["quad", 278, 170, 236, 236]], { stroke: "#284a7a", weight: 10, cap: "round" }),
    // A pear and an orange.
    v.path([["move", 330, 270], ["quad", 300, 250, 322, 214], ["quad", 338, 190, 336, 160], ["quad", 352, 150, 362, 162], ["quad", 364, 196, 386, 220], ["quad", 404, 252, 376, 272], ["close"]], { fill: lit(v, { x0: 306, x1: 402 }, ["#eef0a0", "#b7c24a", "#5d6a1c"]) }),
    v.line(350, 160, 356, 142, { stroke: "#4a3420", weight: 3, cap: "round" }),
    v.circle(468, 254, 34, { fill: v.radialGradient(454, 240, 50, [[0, "#ffd08a"], [0.45, "#f08a24"], [1, "#9a4a0c"]]) }),
  ];
}

export function draw(v: View, _model: Model, p: ParamValues<typeof params>): RootDrawing {
  switch (p.look) {
    case "plain":
      return scene(v);
    case "wash":
      return v.group({ effects: { wash: { granulate: 0.5, edges: 0.6, blotch: 0.5, bleed: 2 } } }, scene(v));
    case "hatching":
      return v.group({ effects: { hatching: { amount: 1 } } }, scene(v));
  }
}
