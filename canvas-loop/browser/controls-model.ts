// The declaration → control descriptor mapping, shared by every renderer. Given
// a sketch's `params` declaration and the current resolved values, it emits a
// plain data list — one `ControlModel` per param — that both the DOM control
// builder (controls.ts) and the React `<ParamControls>` render from. Keeping the
// type/value resolution here (not duplicated in each renderer) means the two
// UIs stay in lock-step: a new param kind or a changed default-fallback rule is
// edited once. No DOM, no React — pure, so it imports cleanly under SSR.
import type { ParamDecl, ParamsDecl, ParamValues } from "../src/core/tea.js";

/** One resolved control: its kind, name, bounds/options, and current value. */
export type ControlModel =
  | { kind: "number"; name: string; min: number; max: number; step: number | "any"; value: number }
  | { kind: "boolean"; name: string; value: boolean }
  | { kind: "select"; name: string; options: readonly string[]; value: string }
  | { kind: "trigger"; name: string };

function modelFor(deps: { name: string; param: ParamDecl; value: number | boolean | string | undefined }): ControlModel {
  const { name, param, value } = deps;
  switch (param.type) {
    case "number":
      return { kind: "number", name, min: param.min, max: param.max, step: param.step ?? "any", value: typeof value === "number" ? value : param.default };
    case "boolean":
      return { kind: "boolean", name, value: typeof value === "boolean" ? value : param.default };
    case "select":
      return { kind: "select", name, options: param.options, value: typeof value === "string" ? value : param.default };
    case "trigger":
      return { kind: "trigger", name };
  }
}

/** Resolve a declaration + current values into the ordered list of controls to render. */
export function controlModels(deps: { decl: ParamsDecl; values: ParamValues<ParamsDecl> }): ControlModel[] {
  const values: Record<string, number | boolean | string> = deps.values;
  return Object.entries(deps.decl).map(([name, param]) => modelFor({ name, param, value: values[name] }));
}
