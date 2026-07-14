// Auto-generated control panel — the design's core claim that data flow is data.
// Given a sketch's `params` declaration, this emits plain HTML inputs (range /
// checkbox / select / button); no widget library, no two-way binding. A widget
// edit calls back into the runtime's `setParam`/`trigger` — the SAME path a
// scripted event takes — so widgets dispatch, they never touch model state.
import type { ParamDecl, ParamsDecl, ParamValues } from "../src/tea.js";

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

function numberControl(deps: { name: string; param: Extract<ParamDecl, { type: "number" }>; value: number; onParam: ControlDeps["onParam"] }): HTMLElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(deps.param.min);
  input.max = String(deps.param.max);
  input.step = String(deps.param.step ?? "any");
  input.value = String(deps.value);
  const readout = document.createElement("span");
  readout.className = "param-value";
  readout.textContent = String(deps.value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    readout.textContent = String(next);
    deps.onParam(deps.name, next);
  });
  const holder = document.createElement("span");
  holder.className = "range-holder";
  holder.append(input, readout);
  return row(deps.name, holder);
}

function booleanControl(deps: { name: string; value: boolean; onParam: ControlDeps["onParam"] }): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = deps.value;
  input.addEventListener("change", () => deps.onParam(deps.name, input.checked));
  return row(deps.name, input);
}

function selectControl(deps: { name: string; param: Extract<ParamDecl, { type: "select" }>; value: string; onParam: ControlDeps["onParam"] }): HTMLElement {
  const select = document.createElement("select");
  for (const option of deps.param.options) {
    const el = document.createElement("option");
    el.value = option;
    el.textContent = option;
    if (option === deps.value) el.selected = true;
    select.append(el);
  }
  select.addEventListener("change", () => deps.onParam(deps.name, select.value));
  return row(deps.name, select);
}

function triggerControl(deps: { name: string; onTrigger: ControlDeps["onTrigger"] }): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "trigger-btn";
  button.textContent = deps.name;
  button.addEventListener("click", () => deps.onTrigger(deps.name));
  const wrap = document.createElement("div");
  wrap.className = "param-row";
  wrap.append(button);
  return wrap;
}

function controlFor(deps: { name: string; param: ParamDecl; value: number | boolean | string | undefined; onParam: ControlDeps["onParam"]; onTrigger: ControlDeps["onTrigger"] }): HTMLElement {
  const { name, param } = deps;
  switch (param.type) {
    case "number":
      return numberControl({ name, param, value: typeof deps.value === "number" ? deps.value : param.default, onParam: deps.onParam });
    case "boolean":
      return booleanControl({ name, value: typeof deps.value === "boolean" ? deps.value : param.default, onParam: deps.onParam });
    case "select":
      return selectControl({ name, param, value: typeof deps.value === "string" ? deps.value : param.default, onParam: deps.onParam });
    case "trigger":
      return triggerControl({ name, onTrigger: deps.onTrigger });
  }
}

/** Build the panel of param widgets for a sketch declaration. */
export function buildControls(deps: ControlDeps): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "params";
  const entries = Object.entries(deps.decl);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "This sketch declares no params.";
    panel.append(empty);
    return panel;
  }
  for (const [name, param] of entries) {
    panel.append(controlFor({ name, param, value: deps.values[name], onParam: deps.onParam, onTrigger: deps.onTrigger }));
  }
  return panel;
}
