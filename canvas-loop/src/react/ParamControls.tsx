// The generated control panel as React: the same declaration → control mapping
// the browser DOM panel uses (controlModels, shared), rendered as plain HTML
// inputs. A widget edit calls `onParam`/`onTrigger` — the runtime's dispatch
// path — so widgets never touch model state. Display values come from `values`
// (the controlled/uncontrolled resolution is the caller's job), so this
// component is fully presentational: no runtime reference, no effects.
import type { JSX } from "react";
import type { ParamsDecl, ParamValues } from "../core/tea.js";
import type { ControlModel } from "../../browser/controls-model.js";
import { controlModels } from "../../browser/controls-model.js";

export interface ParamControlsProps {
  decl: ParamsDecl;
  values: ParamValues<ParamsDecl>;
  onParam: (name: string, value: number | boolean | string) => void;
  onTrigger: (name: string) => void;
}

function NumberRow(props: { model: Extract<ControlModel, { kind: "number" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.name}</span>
      <span className="cl-range-holder">
        <input
          type="range"
          min={model.min}
          max={model.max}
          step={model.step}
          value={model.value}
          onChange={(e) => props.onParam(model.name, Number(e.target.value))}
        />
        <span className="cl-param-value">{model.value}</span>
      </span>
    </label>
  );
}

function BooleanRow(props: { model: Extract<ControlModel, { kind: "boolean" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.name}</span>
      <input type="checkbox" checked={model.value} onChange={(e) => props.onParam(model.name, e.target.checked)} />
    </label>
  );
}

function SelectRow(props: { model: Extract<ControlModel, { kind: "select" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.name}</span>
      <select value={model.value} onChange={(e) => props.onParam(model.name, e.target.value)}>
        {model.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function TriggerRow(props: { model: Extract<ControlModel, { kind: "trigger" }>; onTrigger: ParamControlsProps["onTrigger"] }): JSX.Element {
  const { model } = props;
  return (
    <div className="cl-param-row">
      <button type="button" className="cl-trigger-btn" onClick={() => props.onTrigger(model.name)}>
        {model.name}
      </button>
    </div>
  );
}

function ControlRow(props: { model: ControlModel; onParam: ParamControlsProps["onParam"]; onTrigger: ParamControlsProps["onTrigger"] }): JSX.Element {
  const { model } = props;
  switch (model.kind) {
    case "number":
      return <NumberRow model={model} onParam={props.onParam} />;
    case "boolean":
      return <BooleanRow model={model} onParam={props.onParam} />;
    case "select":
      return <SelectRow model={model} onParam={props.onParam} />;
    case "trigger":
      return <TriggerRow model={model} onTrigger={props.onTrigger} />;
  }
}

/** The panel of param widgets for a sketch declaration — presentational only. */
export function ParamControls(props: ParamControlsProps): JSX.Element {
  const models = controlModels({ decl: props.decl, values: props.values });
  if (models.length === 0) {
    return <p className="cl-muted">This sketch declares no params.</p>;
  }
  return (
    <div className="cl-params">
      {models.map((model) => (
        <ControlRow key={model.name} model={model} onParam={props.onParam} onTrigger={props.onTrigger} />
      ))}
    </div>
  );
}
