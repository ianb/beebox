import { CliError } from "./errors.js";
import type { CanvasSize, Msg, ParamDecl, ParamsDecl, ParamValues, Util, View } from "../core/tea.js";

/**
 * A TEA sketch module after validation; the model is opaque to the runtime.
 * Defined HERE (the loader that produces it) rather than in tea-runtime.ts so
 * that consumers of the validator — including the browser mount, whose type
 * graph must stay free of the node/napi-typed runner — never pull tea-runtime
 * into their program.
 */
export interface LoadedTeaModule {
  params: ParamsDecl;
  canvas: CanvasSize | undefined;
  init(u: Util<ParamsDecl>): unknown;
  update(model: unknown, msg: Msg, u: Util<ParamsDecl>): unknown;
  draw(v: View, model: unknown, p: ParamValues<ParamsDecl>): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readFn<T>(mod: Record<string, unknown>, name: string): T | undefined {
  const value = mod[name];
  if (typeof value !== "function") return undefined;
  // eslint-disable-next-line no-restricted-syntax -- parse boundary: dynamic sketch exports are `unknown`; validated typeof === "function" above
  return value as T;
}

function requireFiniteNumber(params: { record: Record<string, unknown>; key: string; where: string }): number {
  const { record, key, where } = params;
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CliError({ detail: `${where}: "${key}" must be a finite number` });
  }
  return value;
}

function numberParam(record: Record<string, unknown>, where: string): ParamDecl {
  const decl: ParamDecl = {
    type: "number",
    min: requireFiniteNumber({ record, key: "min", where }),
    max: requireFiniteNumber({ record, key: "max", where }),
    default: requireFiniteNumber({ record, key: "default", where }),
  };
  if (record["step"] !== undefined) decl.step = requireFiniteNumber({ record, key: "step", where });
  return decl;
}

function booleanParam(record: Record<string, unknown>, where: string): ParamDecl {
  if (typeof record["default"] !== "boolean") {
    throw new CliError({ detail: `${where}: boolean param needs a boolean "default"` });
  }
  return { type: "boolean", default: record["default"] };
}

function selectParam(record: Record<string, unknown>, where: string): ParamDecl {
  const options = record["options"];
  if (!Array.isArray(options) || options.length === 0 || !options.every((o) => typeof o === "string")) {
    throw new CliError({ detail: `${where}: select param needs a non-empty string[] "options"` });
  }
  const fallback = record["default"];
  if (typeof fallback !== "string" || !options.includes(fallback)) {
    throw new CliError({ detail: `${where}: select param "default" must be one of its options` });
  }
  return { type: "select", options, default: fallback };
}

function parseParam(raw: unknown, name: string): ParamDecl {
  const where = `params.${name}`;
  if (!isRecord(raw)) throw new CliError({ detail: `${where} must be an object` });
  switch (raw["type"]) {
    case "number":
      return numberParam(raw, where);
    case "boolean":
      return booleanParam(raw, where);
    case "select":
      return selectParam(raw, where);
    case "trigger":
      return { type: "trigger" };
    default:
      throw new CliError({ detail: `${where}: "type" must be number|boolean|select|trigger` });
  }
}

function parseParamsDecl(raw: unknown): ParamsDecl {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new CliError({ detail: '"params" export must be an object' });
  const decl: ParamsDecl = {};
  for (const [name, value] of Object.entries(raw)) {
    decl[name] = parseParam(value, name);
  }
  return decl;
}

function parseCanvas(raw: unknown): CanvasSize | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) throw new CliError({ detail: '"canvas" export must be { width, height }' });
  return {
    width: requireFiniteNumber({ record: raw, key: "width", where: "canvas" }),
    height: requireFiniteNumber({ record: raw, key: "height", where: "canvas" }),
  };
}

/** Detect the TEA tier: a module is TEA iff it exports an `update` function. */
export function isTeaModule(mod: Record<string, unknown>): boolean {
  return typeof mod["update"] === "function";
}

/** Validate a dynamically-imported module against the TEA contract. */
export function toTeaModule(mod: Record<string, unknown>): LoadedTeaModule {
  const init = readFn<LoadedTeaModule["init"]>(mod, "init");
  const update = readFn<LoadedTeaModule["update"]>(mod, "update");
  const draw = readFn<LoadedTeaModule["draw"]>(mod, "draw");
  if (init === undefined || update === undefined || draw === undefined) {
    throw new CliError({ detail: "TEA sketch must export init(u), update(model, msg, u), and draw(v, model, p)" });
  }
  return { params: parseParamsDecl(mod["params"]), canvas: parseCanvas(mod["canvas"]), init, update, draw };
}
