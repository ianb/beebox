// Control placements (draft section 8): a kept output of `draw`, apart from
// the scene. The browser turns them into DOM inputs over the canvas, as today;
// headless draws a stand-in for each above the scene, in call order (decision
// 9). A stand-in looks like the browser's bare input: no param label (a sketch
// labels its own controls), a slider (track, thumb, value) for a `number`
// param without `control: "field"`, a box with the value for a field or
// select, a checkbox, and a button with its label.
import { controlModels } from "../../browser/controls-model.js";
import type { ControlModel } from "../../browser/controls-model.js";
import { SketchUsageError } from "../../core/errors.js";
import type { ControlBox, ParamsDecl, ParamValues } from "../../core/tea.js";
import type { Drawing, Style, View } from "../../core/tea.js";
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

/** A stand-in per control, in call order. */
export function drawStandIns(v: View, controls: readonly ControlPlacement[]): Drawing {
  return controls.map((c) => drawStandIn(v, c));
}

/** A slider (a `number` param without `control: "field"`): track, thumb at the value, and the value. */
function drawSlider(v: View, a: { box: Readonly<ControlBox>; model: Extract<ControlModel, { kind: "number" }>; h: number; size: number }): Drawing {
  const { box, model, h, size } = a;
  const value = String(model.value);
  const right = box.x + box.w - 6 - v.textWidth(value, { size }) - 8;
  const x0 = box.x + 6;
  const cy = box.y + h / 2;
  const span = model.max > model.min ? (model.value - model.min) / (model.max - model.min) : 0;
  const tx = x0 + Math.max(0, Math.min(1, span)) * Math.max(0, right - x0);
  return [
    v.roundRect(x0, cy - 2, Math.max(0, right - x0), 4, 2, { fill: "#d0d0d0" }),
    v.roundRect(x0, cy - 2, tx - x0, 4, 2, { fill: "#767676" }),
    v.circle(tx, cy, Math.max(3, Math.min(7, h / 2 - 2)), { fill: "#ffffff", stroke: "#767676", weight: 1 }),
    v.text(value, { x: box.x + box.w - 6, y: cy }, { align: "right", valign: "middle", size, fill: "#111111" }),
  ];
}

/** One stand-in: the bare input, as the browser shows it over the canvas. */
function drawStandIn(v: View, c: ControlPlacement): Drawing {
  const { box, model } = c;
  const h = box.h ?? NATURAL_HEIGHT;
  const size = box.size ?? DEFAULT_SIZE;
  if (model.kind === "boolean") {
    const side = Math.min(h, 16);
    const x = box.x + 1;
    const y = box.y + (h - side) / 2;
    return [
      v.roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 3, FIELD),
      model.value && v.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]], MARK),
    ];
  }
  if (model.kind === "number" && model.control === "slider") return drawSlider(v, { box, model, h, size });
  const button = model.kind === "trigger";
  const field = v.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, h - 1, 3, button ? BUTTON : FIELD);
  const select = model.kind === "select";
  const cx = box.x + box.w - 12;
  const cy = box.y + h / 2;
  const arrow = select && v.path([["move", cx - 4, cy - 2], ["line", cx, cy + 2], ["line", cx + 4, cy - 2]], MARK);
  // A button shows its label as its text; a field or select shows its value.
  const lines = model.kind === "text" && model.multiline;
  const end = box.x + box.w - (select ? 22 : 6);
  const x = box.x + 6;
  // A text box shows its placeholder in grey while empty; a multi-line one wraps from the top.
  const placeholder = model.kind === "text" && model.value === "";
  const label = v.text(shown(model), { x, y: box.y + (lines ? 4 : 0), w: end - x, h: h - (lines ? 8 : 0) }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: lines ? "top" : "middle",
    wrap: lines,
    fit: true,
    size,
    style: box.bold === true ? "bold" : "normal",
    fill: placeholder ? "#767676" : "#111111",
  });
  return [field, arrow, label];
}
