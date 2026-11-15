// Control placements (draft section 8): a kept output of `draw`, apart from
// the scene. The browser turns them into DOM inputs over the canvas, as today;
// headless draws a stand-in for each above the scene, in call order (decision
// 9), drawn as today's headless runtime draws them (headless/tea-view.ts).
import { controlModels } from "../../browser/controls-model.js";
import type { ControlModel } from "../../browser/controls-model.js";
import { SketchUsageError } from "../../core/errors.js";
import type { ControlBox, ParamsDecl, ParamValues } from "../../core/tea.js";
import type { Style, View } from "../../scene-draft/scene-api.js";
import type { DebugBox } from "./debug.js";

/** One `v.control` call: the param, its box in canvas coordinates, and the control as it stood at the call. */
export interface ControlPlacement {
  readonly name: string;
  readonly box: Readonly<ControlBox>;
  readonly model: ControlModel;
}

/** The sketch's params, for resolving a control's kind and value. */
export interface ControlParams {
  readonly decl: ParamsDecl;
  readonly values: () => ParamValues<ParamsDecl>;
}

const NATURAL_HEIGHT = 24;
const DEFAULT_SIZE = 14;

/** A placement for `control(name, box)`, the box copied; an undeclared param is an error, as today. */
export function placeControl(...[name, box, params]: [string, ControlBox, ControlParams | undefined]): ControlPlacement {
  const model = params === undefined ? undefined : controlModels({ decl: params.decl, values: params.values() }).find((m) => m.name === name);
  if (model === undefined) throw new SketchUsageError({ detail: `control("${name}"): no param named "${name}" is declared` });
  return { name, box: { ...box }, model };
}

/** A debug box per control (`run --outline`), as today's runtime adds them. */
export function controlBoxes(controls: readonly ControlPlacement[]): DebugBox[] {
  return controls.map((c) => {
    const { x, y, w } = c.box;
    const h = c.box.h ?? NATURAL_HEIGHT;
    return { label: `control ${c.name}`, corners: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
  });
}

function shown(model: ControlModel): string {
  switch (model.kind) {
    case "number":
      return String(model.value);
    case "select":
      return model.value;
    case "text":
      return model.value === "" ? (model.placeholder ?? "") : model.value;
    case "trigger":
      return model.label;
    case "boolean":
      return "";
  }
}

const FIELD: Style = { fill: "#ffffff", stroke: "#767676", weight: 1 };
const BUTTON: Style = { ...FIELD, fill: "#efefef" };
const MARK: Style = { stroke: "#222222", weight: 1.75 };

/** Draw a stand-in per control, in call order. */
export function drawStandIns(v: View, controls: readonly ControlPlacement[]): void {
  for (const c of controls) drawStandIn(v, c);
}

/** One stand-in: a plain field showing the param's value, as today's headless runtime draws it. */
function drawStandIn(v: View, c: ControlPlacement): void {
  const { box, model } = c;
  const h = box.h ?? NATURAL_HEIGHT;
  if (model.kind === "boolean") {
    const side = Math.min(h, 16);
    const x = box.x + 1;
    const y = box.y + (h - side) / 2;
    v.roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 3, FIELD);
    if (model.value) v.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]], MARK);
    return;
  }
  const button = model.kind === "trigger";
  v.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, h - 1, 3, button ? BUTTON : FIELD);
  const select = model.kind === "select";
  const cx = box.x + box.w - 12;
  const cy = box.y + h / 2;
  if (select) v.path([["move", cx - 4, cy - 2], ["line", cx, cy + 2], ["line", cx + 4, cy - 2]], MARK);
  // A text box shows its placeholder in grey while empty; a multi-line one wraps from the top.
  const placeholder = model.kind === "text" && model.value === "";
  const lines = model.kind === "text" && model.multiline;
  v.text(shown(model), { x: box.x + 6, y: box.y + (lines ? 4 : 0), w: box.w - 6 - (select ? 22 : 6), h: h - (lines ? 8 : 0) }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: lines ? "top" : "middle",
    wrap: lines,
    fit: true,
    size: box.size ?? DEFAULT_SIZE,
    style: box.bold === true ? "bold" : "normal",
    fill: placeholder ? "#767676" : "#111111",
  });
}
