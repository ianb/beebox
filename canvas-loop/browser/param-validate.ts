// The single param-validation definition, shared by both enforcement points:
//   • initial overrides — `sanitizeInitialParams` (called inside `attachSketch`,
//     so every figure surface, imperative and React, validates identically);
//   • live changes — `sanitizeParamChange` (called inside `Runtime.setParam`, the
//     sole entry every live param mutation shares: widget edits, controlled
//     host dispatch, and scripted events).
// Keeping one `checkParam` means a number is finiteness-checked and clamped to
// its declared [min, max] the same way no matter which door a value comes in.
import type { ParamDecl, ParamsDecl } from "../src/core/tea.js";
import type { ParamOverrides } from "./runtime.js";

/** Outcome of checking one value against its declaration. `note` flags an
 * accepted-but-adjusted value (a clamped number) so callers can warn. */
type ParamCheck =
  | { ok: true; value: number | boolean | string; note?: string }
  | { ok: false; reason: string };

/**
 * Validate + coerce a single value against a param declaration. Numbers must be
 * finite (NaN/±Infinity reject) and are clamped into [min, max]; booleans and
 * selects must match their declared shape; triggers never take a value.
 */
function checkParam(param: ParamDecl, value: number | boolean | string): ParamCheck {
  switch (param.type) {
    case "number": {
      if (typeof value !== "number") return { ok: false, reason: `${JSON.stringify(value)} is not a number` };
      if (!Number.isFinite(value)) return { ok: false, reason: `${value} is not a finite number` };
      const clamped = Math.min(param.max, Math.max(param.min, value));
      return clamped === value ? { ok: true, value } : { ok: true, value: clamped, note: `clamped ${value} to the declared [${param.min}, ${param.max}]` };
    }
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: `${JSON.stringify(value)} is not a boolean` };
    case "select":
      return typeof value === "string" && param.options.includes(value)
        ? { ok: true, value }
        : { ok: false, reason: `${JSON.stringify(value)} is not one of the declared options [${param.options.join(", ")}]` };
    case "trigger":
      return { ok: false, reason: "a trigger param takes no value" };
  }
}

/**
 * Validate initial-param overrides against the module's declaration. An unknown
 * name, a trigger, a type-mismatched value, or a non-finite number warns and is
 * dropped — the declared default applies instead; an out-of-range number is
 * clamped into [min, max] (a warning names the param, value, and range). Net-new
 * over the runtime's own handling, which silently ignores unknown names and
 * never type-checks.
 */
export function sanitizeInitialParams(deps: { decl: ParamsDecl; overrides: ParamOverrides | undefined }): ParamOverrides | undefined {
  const { decl, overrides } = deps;
  if (overrides === undefined) return undefined;
  const out: Record<string, number | boolean | string> = {};
  for (const [name, value] of Object.entries(overrides)) {
    const param = decl[name];
    if (param === undefined) {
      console.warn(`canvas-loop: ignoring initial param "${name}" — the sketch declares no such param`);
      continue;
    }
    const check = checkParam(param, value);
    if (!check.ok) {
      console.warn(`canvas-loop: ignoring initial param "${name}" — ${check.reason}; using its default`);
      continue;
    }
    if (check.note !== undefined) console.warn(`canvas-loop: initial param "${name}" ${check.note}`);
    out[name] = check.value;
  }
  return out;
}

/**
 * Validate one live param change against the declaration. Returns the coerced
 * value to dispatch (a number clamped into range), or `undefined` to drop it —
 * warning in either case. The choke point for every live param mutation, since
 * they all pass through `Runtime.setParam`.
 */
export function sanitizeParamChange(deps: {
  decl: ParamsDecl;
  name: string;
  value: number | boolean | string;
}): number | boolean | string | undefined {
  const { decl, name, value } = deps;
  const param = decl[name];
  if (param === undefined) {
    console.warn(`canvas-loop: ignoring param "${name}" — the sketch declares no such param`);
    return undefined;
  }
  const check = checkParam(param, value);
  if (!check.ok) {
    console.warn(`canvas-loop: ignoring param "${name}" — ${check.reason}`);
    return undefined;
  }
  if (check.note !== undefined) console.warn(`canvas-loop: param "${name}" ${check.note}`);
  return check.value;
}
