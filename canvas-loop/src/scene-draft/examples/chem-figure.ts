// An interactive chemistry figure. Shows: params with a control over the
// canvas (unchanged), text measured immediately to size a label box, a
// label-sized hit target, and molecules as pictures memoised on their formula.
import type { View } from "../scene-api.js";

interface Molecule {
  readonly formula: string;
  readonly atoms: readonly { readonly x: number; readonly y: number; readonly element: "H" | "O" }[];
}
// deps are plain data compared by value, so the whole molecule is the dependency.
const COLOR = { H: "#f4f4f4", O: "#d8402a" } as const;

function molecule(v: View, m: Molecule): void {
  for (const a of m.atoms) v.circle(a.x, a.y, a.element === "O" ? 16 : 10, { fill: COLOR[a.element], stroke: "#241c17", weight: 1.5 });
}

export function draw(v: View, model: { coefficient: number; hover: boolean }): void {
  v.background("#f8f4ea");
  const water = { formula: "H2O", atoms: [{ x: 30, y: 30, element: "O" }, { x: 10, y: 46, element: "H" }, { x: 50, y: 46, element: "H" }] } as const satisfies Molecule;
  const pic = v.picture({ key: "molecule", deps: [water], width: 60, height: 60 }, () => molecule(v, water));
  for (let i = 0; i < model.coefficient; i++) v.place(pic, 40 + i * 70, 120);
  // The label box hugs the text: measured now, while drawing.
  const label = `${model.coefficient} H₂O`;
  const b = v.textBounds(label, { x: 40, y: 220 }, { size: 22 });
  v.roundRect(b.x - 8, b.y - 4, b.w + 16, b.h + 8, 6, { fill: model.hover ? "#ffe9a8" : "#fff", stroke: "#241c17", weight: 1.5 });
  v.text(label, { x: 40, y: 220 }, { size: 22, fill: "#241c17" });
  v.debugBox("label hit area", b.x - 8, b.y - 4, b.w + 16, b.h + 8);
  // The coefficient's native input sits over the canvas, as today.
  v.control("coefficient", { x: 40, y: 270, w: 120 });
}
