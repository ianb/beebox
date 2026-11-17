// Strokes kept as data, drawn through a chain of pictures: drag to paint.
// Each finished stroke is a list of pointer points. Picture `layer-N` places
// `layer-(N-1)` and adds stroke N, so finishing a stroke costs one stroke,
// not the whole page, and each frame draws one picture plus the stroke in
// progress. Linked from BRUSHES.md "Gestures" and "Animation and pictures",
// and TEA.md "Pictures".
import type { DeepReadonly, Drawing, Msg, ParamValues, ParamsDecl, RootDrawing, Util, Vec2, View } from "@ianbicking/canvas-loop";

const COLOURS = { ochre: "#c98a2b", indigo: "#2f3f73", madder: "#a8382f", sap: "#4d7a3a" } as const;

export const params = {
  colour: { type: "select", options: ["indigo", "ochre", "madder", "sap"], default: "indigo", label: "Colour" },
} as const satisfies ParamsDecl;

export const canvas = { width: 560, height: 380 };

interface Stroke {
  colour: string;
  points: readonly Vec2[];
}

export interface Model {
  strokes: readonly Stroke[];
  /** The stroke under the pointer, while the button is down. */
  wet: Stroke | null;
}

export function init(_u: Util<typeof params>): Model {
  return { strokes: [], wet: null };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util<typeof params>): Model {
  switch (msg.type) {
    case "mousedown":
      u.handled("start");
      return { ...model, wet: { colour: COLOURS[u.params.colour], points: [[msg.x, msg.y]] } };
    case "mousemove":
      if (model.wet === null) return model;
      u.handled("paint");
      return { ...model, wet: { ...model.wet, points: [...model.wet.points, [msg.x, msg.y]] } };
    case "mouseup":
      if (model.wet === null) return model;
      u.handled("finish");
      return { strokes: [...model.strokes, model.wet], wet: null };
    case "tick":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

function paint(v: View, stroke: DeepReadonly<Stroke>, seed: number): Drawing {
  return stroke.points.length > 1 && v.curve(stroke.points, false, { stroke: stroke.colour, weight: 22, brush: { preset: "bristle", lightJitter: 0.06 }, gesture: { seed } });
}

/** The paper and the first `count` strokes: the picture before it, plus one stroke. */
function layer(v: View, strokes: DeepReadonly<Stroke[]>, count: number): Drawing {
  const picture = v.picture({ key: `layer-${count}`, width: v.width, height: v.height }, () => {
    const stroke = strokes[count - 1];
    return stroke === undefined ? v.background("#f2ebdc") : [layer(v, strokes, count - 1), paint(v, stroke, count)];
  });
  return v.place(picture, 0, 0);
}

export function draw(v: View, model: DeepReadonly<Model>, _p: ParamValues<typeof params>): RootDrawing {
  return [
    layer(v, model.strokes, model.strokes.length),
    model.wet !== null && paint(v, model.wet, model.strokes.length + 1),
  ];
}
