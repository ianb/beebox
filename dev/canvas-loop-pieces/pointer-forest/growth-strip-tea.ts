// Growth strip: each species (rows) at a run of age levels (columns), to
// compare growth stages side by side. `variant` picks the plan; `only` one row.
import type { DeepReadonly, Msg, ParamValues, ParamsDecl, RootDrawing, View } from "@ianbicking/canvas-loop";
import { LEVELS, PLANS, SPECIES, treePicture } from "./tree-tea.js";

export const params = {
  variant: { type: "number", default: 0, min: 0, max: 2, step: 1, label: "Variant" },
  only: { type: "number", default: -1, min: -1, max: 5, step: 1, label: "Species (-1 all)" },
} as const satisfies ParamsDecl;
type P = typeof params;

const COLS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16];
const CW = 112;
const RH = 205;
const S = 0.78;
export const canvas = { width: CW * COLS.length + 20, height: RH * SPECIES.length + 20 };

export type Model = { readonly n: number };
export function init(): Model { return { n: 0 }; }
export function update(model: DeepReadonly<Model>, _msg: Msg): Model { return model as Model; }

export function draw(v: View, _m: DeepReadonly<Model>, p: ParamValues<P>): RootDrawing {
  return [
    v.rect(0, 0, v.width, v.height, { fill: "oklch(0.86 0.05 130)" }),
    SPECIES.map((sp, row) => p.only >= 0 && row !== p.only ? null : COLS.map((lvl, col) => {
      const plan = PLANS[sp][p.variant] ?? PLANS[sp][0];
      if (plan === undefined) return null;
      const x = 10 + col * CW + CW / 2;
      const y = 10 + (row + 1) * RH - 8;
      return v.at({ translate: [x, y], scale: S }, [
        v.place(treePicture(v, plan, { part: "wood", level: lvl }), 0, 0),
        v.place(treePicture(v, plan, { part: "back", level: lvl }), 0, 0),
        v.place(treePicture(v, plan, { part: "front", level: lvl }), 0, 0),
      ]);
    })),
    COLS.map((lvl, col) => v.text(`${lvl}/${LEVELS}`, { x: 10 + col * CW + CW / 2 - 14, y: 2 }, { size: 11, fill: "#333" })),
  ];
}
