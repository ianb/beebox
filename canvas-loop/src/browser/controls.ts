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
import type { ControlBox, ParamsDecl, ParamValues } from "../core/tea.js";
import type { ControlModel } from "./controls-model.js";
import { controlModels, parseField } from "./controls-model.js";

export interface ControlDeps {
  decl: ParamsDecl;
  values: ParamValues<ParamsDecl>;
  onParam: (name: string, value: number | boolean | string) => void;
  onTrigger: (name: string) => void;
  /** CSS class prefix ("" for the playground styles, "cl-" for figure.css). */
  classPrefix?: string;
  /** Params whose inputs sit over the canvas instead (`v.control`): left out of the panel. */
  exclude?: ReadonlySet<string>;
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

interface Deps<K extends ControlModel["kind"]> {
  model: Extract<ControlModel, { kind: K }>;
  onParam: ControlDeps["onParam"];
  prefix: string;
}

/** A typed number field: sends each valid entry; marks an invalid one and sends nothing. */
function fieldInput(deps: Deps<"number">): HTMLInputElement {
  const { model } = deps;
  const input = document.createElement("input");
  input.type = "number";
  input.className = `${deps.prefix}field`;
  input.min = String(model.min);
  input.max = String(model.max);
  input.step = String(model.step);
  input.value = String(model.value);
  input.addEventListener("input", () => {
    const next = parseField(input.value, model);
    input.setAttribute("aria-invalid", String(next === undefined));
    if (next !== undefined) deps.onParam(model.name, next);
  });
  return input;
}

function rangeInput(deps: Deps<"number"> & { onValue?: (value: number) => void }): HTMLInputElement {
  const { model } = deps;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(model.min);
  input.max = String(model.max);
  input.step = String(model.step);
  input.value = String(model.value);
  input.addEventListener("input", () => {
    const next = Number(input.value);
    deps.onValue?.(next);
    deps.onParam(model.name, next);
  });
  return input;
}

function checkboxInput(deps: Deps<"boolean">): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = deps.model.value;
  input.addEventListener("change", () => deps.onParam(deps.model.name, input.checked));
  return input;
}

function selectInput(deps: Deps<"select">): HTMLSelectElement {
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
  return select;
}

function triggerButton(deps: { model: Extract<ControlModel, { kind: "trigger" }>; onTrigger: ControlDeps["onTrigger"]; prefix: string }): HTMLButtonElement {
  const { model } = deps;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${deps.prefix}trigger-btn`;
  button.textContent = model.label;
  if (model.hint !== undefined) button.title = model.hint;
  button.addEventListener("click", () => deps.onTrigger(model.name));
  return button;
}

function numberControl(deps: Deps<"number">): HTMLElement {
  const { model, prefix } = deps;
  if (model.control === "field") return row(model, { control: fieldInput(deps), prefix });
  const readout = document.createElement("span");
  readout.className = `${prefix}param-value`;
  readout.textContent = String(model.value);
  const input = rangeInput({ ...deps, onValue: (next) => (readout.textContent = String(next)) });
  const holder = document.createElement("span");
  holder.className = `${prefix}range-holder`;
  holder.append(input, readout);
  return row(model, { control: holder, prefix });
}

/** A param's bare input and how to show a new value in it. */
export interface BareInput {
  element: HTMLElement;
  /** Show `model`'s value, unless the person is editing this input. */
  show: (model: ControlModel) => void;
}

function shower(element: HTMLInputElement | HTMLSelectElement): BareInput["show"] {
  return (model) => {
    if (document.activeElement === element) return;
    if (model.kind !== "number" && model.kind !== "select") return;
    const value = String(model.value);
    if (element.value !== value) element.value = value;
    element.removeAttribute("aria-invalid");
  };
}

/**
 * The bare native input for one param (no row, caption or readout), labelled
 * for assistive tech by the param's label: what an over-canvas control shows.
 */
export function bareInput(deps: { model: ControlModel; onParam: ControlDeps["onParam"]; onTrigger: ControlDeps["onTrigger"]; prefix: string }): BareInput {
  const { model, prefix, onParam } = deps;
  const made = ((): BareInput => {
    switch (model.kind) {
      case "number": {
        const input = model.control === "field" ? fieldInput({ model, onParam, prefix }) : rangeInput({ model, onParam, prefix });
        return { element: input, show: shower(input) };
      }
      case "boolean": {
        const input = checkboxInput({ model, onParam, prefix });
        const show = (next: ControlModel): void => {
          if (next.kind === "boolean" && document.activeElement !== input) input.checked = next.value;
        };
        return { element: input, show };
      }
      case "select": {
        const select = selectInput({ model, onParam, prefix });
        return { element: select, show: shower(select) };
      }
      case "trigger":
        return { element: triggerButton({ model, onTrigger: deps.onTrigger, prefix }), show: () => {} };
    }
  })();
  if (model.kind !== "trigger") made.element.setAttribute("aria-label", model.label);
  if (model.hint !== undefined) made.element.title = model.hint;
  return made;
}

function controlFor(deps: { model: ControlModel; onParam: ControlDeps["onParam"]; onTrigger: ControlDeps["onTrigger"]; prefix: string }): HTMLElement {
  const { model, prefix } = deps;
  switch (model.kind) {
    case "number":
      return numberControl({ model, onParam: deps.onParam, prefix });
    case "boolean":
      return row(model, { control: checkboxInput({ model, onParam: deps.onParam, prefix }), prefix });
    case "select":
      return row(model, { control: selectInput({ model, onParam: deps.onParam, prefix }), prefix });
    case "trigger": {
      const wrap = document.createElement("div");
      wrap.className = `${prefix}param-row`;
      wrap.append(triggerButton({ model, onTrigger: deps.onTrigger, prefix }));
      return wrap;
    }
  }
}

/** Build the panel of param widgets for a sketch declaration. */
export function buildControls(deps: ControlDeps): HTMLElement {
  const prefix = deps.classPrefix ?? "";
  const panel = document.createElement("div");
  panel.className = `${prefix}params`;
  const models = controlModels({ decl: deps.decl, values: deps.values }).filter(
    (model) => deps.decl[model.name]?.panel !== false && deps.exclude?.has(model.name) !== true,
  );
  const hidden = Object.values(deps.decl).some((param) => param.panel === false) || (deps.exclude?.size ?? 0) > 0;
  if (models.length === 0 && hidden) return panel;
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

// ── over-canvas inputs ───────────────────────────────────────────────
// Native param inputs laid over the canvas where the sketch's `v.control`
// placed them. Positions are percentages of the canvas's logical size, so the
// inputs track the canvas when CSS scales it. An input the sketch stops placing
// is hidden, not removed, so a focused field keeps its state across frames.

export class ControlOverlay {
  #stage: HTMLElement;
  #size: { width: number; height: number };
  #decl: ParamsDecl;
  #handlers: Pick<ControlDeps, "onParam" | "onTrigger">;
  #inputs = new Map<string, BareInput>();
  #shown = "";
  #onShownChange: (names: ReadonlySet<string>) => void;

  constructor(deps: {
    stage: HTMLElement;
    size: { width: number; height: number };
    decl: ParamsDecl;
    handlers: Pick<ControlDeps, "onParam" | "onTrigger">;
    /** Called when the set of placed params changes (the panel leaves them out). */
    onShownChange: (names: ReadonlySet<string>) => void;
  }) {
    this.#stage = deps.stage;
    this.#size = deps.size;
    this.#decl = deps.decl;
    this.#handlers = deps.handlers;
    this.#onShownChange = deps.onShownChange;
  }

  sync(placements: ReadonlyMap<string, ControlBox>, values: ParamValues<ParamsDecl>): void {
    // Text sizes are logical pixels; scale them as CSS scales the canvas.
    const shownWidth = this.#stage.clientWidth;
    const scale = shownWidth > 0 ? shownWidth / this.#size.width : 1;
    const models = new Map(controlModels({ decl: this.#decl, values }).map((model) => [model.name, model]));
    for (const [name, box] of placements) {
      const model = models.get(name);
      if (model === undefined) continue;
      let input = this.#inputs.get(name);
      if (input === undefined) {
        input = bareInput({ model, ...this.#handlers, prefix: "cl-" });
        const { element } = input;
        element.className = `${element.className} cl-overlay-input`.trim();
        element.style.position = "absolute";
        element.style.boxSizing = "border-box";
        element.style.margin = "0";
        this.#inputs.set(name, input);
        this.#stage.append(element);
      }
      this.#place(input.element, { box, scale });
      input.show(model);
    }
    for (const [name, input] of this.#inputs) {
      if (!placements.has(name)) input.element.style.display = "none";
    }
    const shown = [...placements.keys()].filter((name) => models.has(name)).toSorted().join("\n");
    if (shown !== this.#shown) {
      this.#shown = shown;
      this.#onShownChange(new Set(shown === "" ? [] : shown.split("\n")));
    }
  }

  #place(input: HTMLElement, at: { box: ControlBox; scale: number }): void {
    const { box } = at;
    const { width, height } = this.#size;
    const style = input.style;
    style.fontSize = `${(box.size ?? 14) * at.scale}px`;
    style.fontWeight = box.bold === true ? "bold" : "";
    style.textAlign = box.align ?? "";
    style.display = "";
    style.left = `${(box.x / width) * 100}%`;
    style.top = `${(box.y / height) * 100}%`;
    style.width = `${(box.w / width) * 100}%`;
    style.height = box.h === undefined ? "" : `${(box.h / height) * 100}%`;
  }

  remove(): void {
    for (const input of this.#inputs.values()) input.element.remove();
    this.#inputs.clear();
  }
}
