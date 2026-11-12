// Auto-generated control panel — the design's core claim that data flow is data.
// Given a sketch's `params` declaration, this emits plain HTML inputs (range /
// checkbox / select / button); no widget library, no two-way binding. A widget
// edit calls back into the runtime's `setParam`/`trigger` — the SAME path a
// scripted event takes — so widgets dispatch, they never touch model state. The
// declaration → control resolution lives in controls-model.ts, shared with the
// React `<ParamControls>` so both UIs render an identical control set.
//
// `classPrefix` selects the CSS vocabulary: the playground uses the bare names
// (its own page stylesheet), figure embeds pass "cl-" to match figure.css —
// the same classes <ParamControls> renders.
import type { ParamsDecl, ParamValues } from "../core/tea.js";
import type { ControlModel } from "./controls-model.js";
import { controlModels, parseField } from "./controls-model.js";

export interface ControlDeps {
  decl: ParamsDecl;
  values: ParamValues<ParamsDecl>;
  onParam: (name: string, value: number | boolean | string) => void;
  onTrigger: (name: string) => void;
  /** CSS class prefix ("" for the playground styles, "cl-" for figure.css). */
  classPrefix?: string;
}

function row(text: { label: string; hint: string | undefined }, deps: { control: HTMLElement; prefix: string }): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = `${deps.prefix}param-row`;
  const caption = document.createElement("span");
  caption.className = `${deps.prefix}param-name`;
  caption.textContent = text.label;
  wrap.append(caption, deps.control);
  if (text.hint !== undefined) {
    const hint = document.createElement("span");
    hint.className = `${deps.prefix}param-hint`;
    hint.textContent = text.hint;
    wrap.append(hint);
  }
  return wrap;
}

/** A typed number field: sends each valid entry; marks an invalid one and sends nothing. */
function fieldControl(deps: { model: Extract<ControlModel, { kind: "number" }>; onParam: ControlDeps["onParam"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  const input = document.createElement("input");
  input.type = "number";
  input.className = `${prefix}field`;
  input.min = String(model.min);
  input.max = String(model.max);
  input.step = String(model.step);
  input.value = String(model.value);
  input.addEventListener("input", () => {
    const next = parseField(input.value, model);
    input.setAttribute("aria-invalid", String(next === undefined));
    if (next !== undefined) deps.onParam(model.name, next);
  });
  return row(model, { control: input, prefix });
}

function numberControl(deps: { model: Extract<ControlModel, { kind: "number" }>; onParam: ControlDeps["onParam"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  if (model.control === "field") return fieldControl(deps);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(model.min);
  input.max = String(model.max);
  input.step = String(model.step);
  input.value = String(model.value);
  const readout = document.createElement("span");
  readout.className = `${prefix}param-value`;
  readout.textContent = String(model.value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = String(next);
    deps.onParam(model.name, next);
  });
  const holder = document.createElement("span");
  holder.className = `${prefix}range-holder`;
  holder.append(input, readout);
  return row(model, { control: holder, prefix });
}

function booleanControl(deps: { model: Extract<ControlModel, { kind: "boolean" }>; onParam: ControlDeps["onParam"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = model.value;
  input.addEventListener("change", () => deps.onParam(model.name, input.checked));
  return row(model, { control: input, prefix });
}

function selectControl(deps: { model: Extract<ControlModel, { kind: "select" }>; onParam: ControlDeps["onParam"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  const select = document.createElement("select");
  for (const option of model.options) {
    const el = document.createElement("option");
    el.value = option;
    el.textContent = option;
    if (option === model.value) el.selected = true;
    select.append(el);
  }
  select.addEventListener("change", () => deps.onParam(model.name, select.value));
  return row(model, { control: select, prefix });
}

function triggerControl(deps: { model: Extract<ControlModel, { kind: "trigger" }>; onTrigger: ControlDeps["onTrigger"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${prefix}trigger-btn`;
  button.textContent = model.label;
  if (model.hint !== undefined) button.title = model.hint;
  button.addEventListener("click", () => deps.onTrigger(model.name));
  const wrap = document.createElement("div");
  wrap.className = `${prefix}param-row`;
  wrap.append(button);
  return wrap;
}

function controlFor(deps: { model: ControlModel; onParam: ControlDeps["onParam"]; onTrigger: ControlDeps["onTrigger"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  switch (model.kind) {
    case "number":
      return numberControl({ model, onParam: deps.onParam, prefix });
    case "boolean":
      return booleanControl({ model, onParam: deps.onParam, prefix });
    case "select":
      return selectControl({ model, onParam: deps.onParam, prefix });
    case "trigger":
      return triggerControl({ model, onTrigger: deps.onTrigger, prefix });
  }
}

/** Build the panel of param widgets for a sketch declaration. */
export function buildControls(deps: ControlDeps): HTMLElement {
  const prefix = deps.classPrefix ?? "";
  const panel = document.createElement("div");
  panel.className = `${prefix}params`;
  const models = controlModels({ decl: deps.decl, values: deps.values });
  if (models.length === 0) {
    const empty = document.createElement("p");
    empty.className = `${prefix}muted`;
    empty.textContent = "This sketch declares no params.";
    panel.append(empty);
    return panel;
  }
  for (const model of models) {
    panel.append(controlFor({ model, onParam: deps.onParam, onTrigger: deps.onTrigger, prefix }));
  }
  return panel;
}
