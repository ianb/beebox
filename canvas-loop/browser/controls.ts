// Auto-generated control panel — the design's core claim that data flow is data.
// Given a sketch's `params` declaration, this emits plain HTML inputs (range /
// checkbox / select / button); no widget library, no two-way binding. A widget
// edit calls back into the runtime's `setParam`/`trigger` — the SAME path a
// scripted event takes — so widgets dispatch, they never touch model state. The
// declaration → control resolution lives in controls-model.ts, shared with the
// React `<ParamControls>` so both UIs render an identical control set.
import type { ParamsDecl, ParamValues } from "../src/core/tea.js";
import type { ControlModel } from "./controls-model.js";
import { controlModels } from "./controls-model.js";

export interface ControlDeps {
  decl: ParamsDecl;
  values: ParamValues<ParamsDecl>;
  onParam: (name: string, value: number | boolean | string) => void;
  onTrigger: (name: string) => void;
}

function row(name: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "param-row";
  const caption = document.createElement("span");
  caption.className = "param-name";
  caption.textContent = name;
  wrap.append(caption, control);
  return wrap;
}

function numberControl(deps: { model: Extract<ControlModel, { kind: "number" }>; onParam: ControlDeps["onParam"] }): HTMLElement {
  const { model } = deps;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(model.min);
  input.max = String(model.max);
  input.step = String(model.step);
  input.value = String(model.value);
  const readout = document.createElement("span");
  readout.className = "param-value";
  readout.textContent = String(model.value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = String(next);
    deps.onParam(model.name, next);
  });
  const holder = document.createElement("span");
  holder.className = "range-holder";
  holder.append(input, readout);
  return row(model.name, holder);
}

function booleanControl(deps: { model: Extract<ControlModel, { kind: "boolean" }>; onParam: ControlDeps["onParam"] }): HTMLElement {
  const { model } = deps;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = model.value;
  input.addEventListener("change", () => deps.onParam(model.name, input.checked));
  return row(model.name, input);
}

function selectControl(deps: { model: Extract<ControlModel, { kind: "select" }>; onParam: ControlDeps["onParam"] }): HTMLElement {
  const { model } = deps;
  const select = document.createElement("select");
  for (const option of model.options) {
    const el = document.createElement("option");
    el.value = option;
    el.textContent = option;
    if (option === model.value) el.selected = true;
    select.append(el);
  }
  select.addEventListener("change", () => deps.onParam(model.name, select.value));
  return row(model.name, select);
}

function triggerControl(deps: { model: Extract<ControlModel, { kind: "trigger" }>; onTrigger: ControlDeps["onTrigger"] }): HTMLElement {
  const { model } = deps;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "trigger-btn";
  button.textContent = model.name;
  button.addEventListener("click", () => deps.onTrigger(model.name));
  const wrap = document.createElement("div");
  wrap.className = "param-row";
  wrap.append(button);
  return wrap;
}

function controlFor(deps: { model: ControlModel; onParam: ControlDeps["onParam"]; onTrigger: ControlDeps["onTrigger"] }): HTMLElement {
  const { model } = deps;
  switch (model.kind) {
    case "number":
      return numberControl({ model, onParam: deps.onParam });
    case "boolean":
      return booleanControl({ model, onParam: deps.onParam });
    case "select":
      return selectControl({ model, onParam: deps.onParam });
    case "trigger":
      return triggerControl({ model, onTrigger: deps.onTrigger });
  }
}

/** Build the panel of param widgets for a sketch declaration. */
export function buildControls(deps: ControlDeps): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "params";
  const models = controlModels({ decl: deps.decl, values: deps.values });
  if (models.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "This sketch declares no params.";
    panel.append(empty);
    return panel;
  }
  for (const model of models) {
    panel.append(controlFor({ model, onParam: deps.onParam, onTrigger: deps.onTrigger }));
  }
  return panel;
}
