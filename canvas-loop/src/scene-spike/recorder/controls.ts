// Control placements (draft section 8): a kept output of `draw`, apart from
// the scene. The browser turns them into DOM inputs over the canvas, as today;
// headless draws a stand-in for each above the scene, in call order (decision
// 9): as today's headless runtime draws them (headless/tea-view.ts), plus the
// param's label, and a slider (track and thumb) for a `number` param without
// `control: "field"`.
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

const LABEL = "#555555";

/** The param's label in grey at `x`, vertically centred in the box; returns where what follows it starts. */
function label(v: View, c: { text: string; x: number; box: Readonly<ControlBox>; h: number; size: number }): number {
  v.text(c.text, { x: c.x, y: c.box.y + c.h / 2 }, { valign: "middle", size: c.size, fill: LABEL });
  return c.x + v.textWidth(c.text, { size: c.size }) + 8;
}

/** A slider (a `number` param without `control: "field"`): label, track, thumb at the value, and the value. */
function drawSlider(v: View, a: { box: Readonly<ControlBox>; model: Extract<ControlModel, { kind: "number" }>; h: number; size: number }): void {
  const { box, model, h, size } = a;
  const value = String(model.value);
  const right = box.x + box.w - 6 - v.textWidth(value, { size }) - 8;
  // The label goes first when it leaves the track at least 24 px.
  const afterLabel = box.x + 6 + v.textWidth(model.label, { size }) + 8;
  const x0 = right - afterLabel >= 24 ? label(v, { text: model.label, x: box.x + 6, box, h, size }) : box.x + 6;
  const cy = box.y + h / 2;
  const span = model.max > model.min ? (model.value - model.min) / (model.max - model.min) : 0;
  const tx = x0 + Math.max(0, Math.min(1, span)) * Math.max(0, right - x0);
  v.roundRect(x0, cy - 2, Math.max(0, right - x0), 4, 2, { fill: "#d0d0d0" });
  v.roundRect(x0, cy - 2, tx - x0, 4, 2, { fill: "#767676" });
  v.circle(tx, cy, Math.max(3, Math.min(7, h / 2 - 2)), { fill: "#ffffff", stroke: "#767676", weight: 1 });
  v.text(value, { x: box.x + box.w - 6, y: cy }, { align: "right", valign: "middle", size, fill: "#111111" });
}

/** One stand-in, with the param's label (the browser's input carries it as its accessible name). */
function drawStandIn(v: View, c: ControlPlacement): void {
  const { box, model } = c;
  const h = box.h ?? NATURAL_HEIGHT;
  const size = box.size ?? DEFAULT_SIZE;
  if (model.kind === "boolean") {
    const side = Math.min(h, 16);
    const x = box.x + 1;
    const y = box.y + (h - side) / 2;
    v.roundRect(x + 0.5, y + 0.5, side - 1, side - 1, 3, FIELD);
    if (model.value) v.path([["move", x + side * 0.22, y + side * 0.52], ["line", x + side * 0.42, y + side * 0.72], ["line", x + side * 0.78, y + side * 0.28]], MARK);
    label(v, { text: model.label, x: x + side + 6, box, h, size });
    return;
  }
  if (model.kind === "number" && model.control === "slider") {
    drawSlider(v, { box, model, h, size });
    return;
  }
  const button = model.kind === "trigger";
  v.roundRect(box.x + 0.5, box.y + 0.5, box.w - 1, h - 1, 3, button ? BUTTON : FIELD);
  const select = model.kind === "select";
  const cx = box.x + box.w - 12;
  const cy = box.y + h / 2;
  if (select) v.path([["move", cx - 4, cy - 2], ["line", cx, cy + 2], ["line", cx + 4, cy - 2]], MARK);
  // A button shows its label as its text; a field shows the label in grey before its value when there is room.
  const lines = model.kind === "text" && model.multiline;
  const end = box.x + box.w - (select ? 22 : 6);
  const withLabel = !button && !lines && end - (box.x + 6 + v.textWidth(model.label, { size })) >= 40;
  const x = withLabel ? label(v, { text: model.label, x: box.x + 6, box, h, size }) : box.x + 6;
  // A text box shows its placeholder in grey while empty; a multi-line one wraps from the top.
  const placeholder = model.kind === "text" && model.value === "";
  v.text(shown(model), { x, y: box.y + (lines ? 4 : 0), w: end - x, h: h - (lines ? 8 : 0) }, {
    align: button ? "center" : (box.align ?? "left"),
    valign: lines ? "top" : "middle",
    wrap: lines,
    fit: true,
    size,
    style: box.bold === true ? "bold" : "normal",
    fill: placeholder ? "#767676" : "#111111",
  });
}
