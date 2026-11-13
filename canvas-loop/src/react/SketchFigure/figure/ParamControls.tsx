// The generated control panel as React: the same declaration → control mapping
// the browser DOM panel uses (controlModels, shared), rendered as plain HTML
// inputs. A widget edit calls `onParam`/`onTrigger` — the runtime's dispatch
// path — so widgets never touch model state. Display values come from `values`
// (the controlled/uncontrolled resolution is the caller's job), so this
// component is fully presentational: no runtime reference, no effects.
import { useState } from "react";
import type { JSX } from "react";
import type { ParamsDecl, ParamValues } from "../../../core/tea.js";
import type { ControlModel } from "../../../browser/controls-model.js";
import { controlModels, parseField } from "../../../browser/controls-model.js";

export interface ParamControlsProps {
  decl: ParamsDecl;
  values: ParamValues<ParamsDecl>;
  onParam: (name: string, value: number | boolean | string) => void;
  onTrigger: (name: string) => void;
}

/** A typed number field: keeps what the person typed, sends each valid entry, marks an invalid one. */
function FieldRow(props: { model: Extract<ControlModel, { kind: "number" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  const [text, setText] = useState(String(model.value));
  const valid = parseField(text, model) !== undefined;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.label}</span>
      <input
        type="number"
        className="cl-field"
        min={model.min}
        max={model.max}
        step={model.step}
        value={text}
        aria-invalid={!valid}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseField(e.target.value, model);
          if (next !== undefined) props.onParam(model.name, next);
        }}
      />
      <Hint hint={model.hint} />
    </label>
  );
}

/**
 * A text box: keeps what the person typed as its own draft and sends every
 * edit. The runtime echoes values back a frame later, so showing `model.value`
 * would undo keystrokes typed in between.
 */
function TextRow(props: { model: Extract<ControlModel, { kind: "text" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  const [draft, setDraft] = useState(model.value);
  const onChange = (value: string): void => {
    setDraft(value);
    props.onParam(model.name, value);
  };
  const shared = { className: "cl-text", value: draft, placeholder: model.placeholder, maxLength: model.maxLength, spellCheck: false };
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.label}</span>
      {model.multiline ? <textarea {...shared} onChange={(e) => onChange(e.target.value)} /> : <input type="text" {...shared} onChange={(e) => onChange(e.target.value)} />}
      <Hint hint={model.hint} />
    </label>
  );
}

function Hint(props: { hint: string | undefined }): JSX.Element | null {
  return props.hint === undefined ? null : <span className="cl-param-hint">{props.hint}</span>;
}

function NumberRow(props: { model: Extract<ControlModel, { kind: "number" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  if (model.control === "field") return <FieldRow model={model} onParam={props.onParam} />;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.label}</span>
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
      <Hint hint={model.hint} />
    </label>
  );
}

function BooleanRow(props: { model: Extract<ControlModel, { kind: "boolean" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.label}</span>
      <input type="checkbox" checked={model.value} onChange={(e) => props.onParam(model.name, e.target.checked)} />
      <Hint hint={model.hint} />
    </label>
  );
}

function SelectRow(props: { model: Extract<ControlModel, { kind: "select" }>; onParam: ParamControlsProps["onParam"] }): JSX.Element {
  const { model } = props;
  return (
    <label className="cl-param-row">
      <span className="cl-param-name">{model.label}</span>
      <select value={model.value} onChange={(e) => props.onParam(model.name, e.target.value)}>
        {model.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <Hint hint={model.hint} />
    </label>
  );
}

function TriggerRow(props: { model: Extract<ControlModel, { kind: "trigger" }>; onTrigger: ParamControlsProps["onTrigger"] }): JSX.Element {
  const { model } = props;
  return (
    <div className="cl-param-row">
      <button type="button" className="cl-trigger-btn" title={model.hint} onClick={() => props.onTrigger(model.name)}>
        {model.label}
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
    case "text":
      return <TextRow model={model} onParam={props.onParam} />;
    case "trigger":
      return <TriggerRow model={model} onTrigger={props.onTrigger} />;
  }
}

/** The panel of param widgets for a sketch declaration — presentational only. */
export function ParamControls(props: ParamControlsProps): JSX.Element {
  const models = controlModels({ decl: props.decl, values: props.values }).filter((model) => props.decl[model.name]?.panel !== false);
  if (models.length === 0) {
    if (Object.keys(props.decl).length > 0) return <div className="cl-params" />;
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
