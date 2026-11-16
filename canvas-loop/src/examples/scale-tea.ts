// A balance with two pans, hit by name (TEA.md, "Names and hits"):
//
//   - each pan is a `v.at` named `pan-left` or `pan-right`; click a pan to add
//     a weight. The bowl has `fill: "transparent"`, so its inside takes the hit.
//   - each weight is named from its model id (`weight-3`), inside its pan, so
//     a click on it has `targets` `["weight-3", "pan-left"]`: it removes the
//     weight instead of adding one.
//   - the caption is a column holding a row (TEA.md, "Layout").
//
// `update` never repeats `draw`'s position math, and the events file aims by
// `"target"`, so the clicks follow the pans as the beam tilts.
import type { DeepReadonly, Drawing, Msg, RootDrawing, Util, View } from "@ianbicking/canvas-loop";

export const canvas = { width: 480, height: 340 };

type Side = "left" | "right";

export interface Model {
  left: readonly number[];
  right: readonly number[];
  nextId: number;
  tilt: number;
}

const PIVOT = { x: 240, y: 70 } as const;
const ARM = 140;
const DROP = 90;
const BOWL = 56;
const FULL = 5;
const INK = "#334155";
const LABEL = { size: 15, fill: INK } as const;
const SMALL = { size: 13, fill: "#64748b" } as const;

/** Where the beam tilts to: positive lowers the left end. */
function targetTilt(model: DeepReadonly<Model>): number {
  return Math.max(-0.35, Math.min(0.35, (model.left.length - model.right.length) * 0.08));
}

/** Remove a weight by its name; one already gone (removed since that frame) is ignored. */
function remove(model: DeepReadonly<Model>, name: string): Model {
  const id = Number(name.slice("weight-".length));
  return { ...model, left: model.left.filter((w) => w !== id), right: model.right.filter((w) => w !== id) };
}

export function init(): Model {
  return { left: [], right: [], nextId: 1, tilt: 0 };
}

export function update(model: DeepReadonly<Model>, msg: Msg, u: Util): Model {
  switch (msg.type) {
    case "tick":
      return { ...model, tilt: model.tilt + (targetTilt(model) - model.tilt) * 0.15 };
    case "mousedown": {
      const weight = msg.targets.find((t) => t.startsWith("weight-"));
      if (weight !== undefined) {
        u.handled("remove-weight");
        return remove(model, weight);
      }
      const side = msg.targets.includes("pan-left") ? "left" : msg.targets.includes("pan-right") ? "right" : null;
      if (side === null || model[side].length >= FULL) return model;
      u.handled(`add-weight-${side}`);
      return { ...model, [side]: [...model[side], model.nextId], nextId: model.nextId + 1 };
    }
    case "mouseup":
    case "mousemove":
    case "keydown":
    case "keyup":
    case "param":
    case "trigger":
      return model;
  }
}

/** One pan hanging from a beam end, its weights inside, all under the pan's name. */
function pan(v: View, opts: { side: Side; end: { x: number; y: number }; weights: readonly number[] }): Drawing {
  const { side, end, weights } = opts;
  const top = end.y + DROP;
  return [
    v.line(end.x, end.y, end.x - BOWL, top, { stroke: INK, weight: 1.5 }),
    v.line(end.x, end.y, end.x + BOWL, top, { stroke: INK, weight: 1.5 }),
    v.at({ translate: [end.x, top], name: `pan-${side}` }, [
      v.arc(0, 0, BOWL, 0, Math.PI, { fill: "transparent", stroke: INK, weight: 3 }),
      weights.map((id, i) => {
        const x = -28 + 14 * i;
        return v.circle(x, Math.sqrt(BOWL * BOWL - x * x) - 11, 7, { fill: "#d4a017", stroke: "#8a6a0c", weight: 1.5, name: `weight-${id}` });
      }),
    ]),
  ];
}

export function draw(v: View, model: DeepReadonly<Model>): RootDrawing {
  const dx = ARM * Math.cos(model.tilt);
  const dy = ARM * Math.sin(model.tilt);
  const verdict = model.left.length === model.right.length ? "balanced" : model.left.length > model.right.length ? "left is heavier" : "right is heavier";
  return [
    v.background("#f8fafc"),
    v.polygon([[PIVOT.x, PIVOT.y], [PIVOT.x - 30, 300], [PIVOT.x + 30, 300]], { fill: "#cbd5e1" }),
    v.line(PIVOT.x - dx, PIVOT.y + dy, PIVOT.x + dx, PIVOT.y - dy, { stroke: INK, weight: 5 }),
    pan(v, { side: "left", end: { x: PIVOT.x - dx, y: PIVOT.y + dy }, weights: model.left }),
    pan(v, { side: "right", end: { x: PIVOT.x + dx, y: PIVOT.y - dy }, weights: model.right }),
    v.column({ x: PIVOT.x, y: 302, gap: 4, align: "center" }, [
      v.row({ gap: 10, valign: "baseline" }, [
        v.text(`Left ${model.left.length} g`, { x: 0, y: 0 }, LABEL),
        v.text("·", { x: 0, y: 0 }, SMALL),
        v.text(`Right ${model.right.length} g`, { x: 0, y: 0 }, LABEL),
      ]),
      v.text(`${verdict}: click a pan to add a weight, a weight to take it off`, { x: 0, y: 0 }, SMALL),
    ]),
  ];
}
