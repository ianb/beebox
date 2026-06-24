/**
 * Figure embed parameters.
 *
 * A figure card declares its accepted parameters in frontmatter (`params`);
 * the embed `view:` link supplies values in its query string. Embed values
 * always arrive as strings, so this module parses the declared contract and
 * coerces supplied values to the declared type, filling declared defaults and
 * omitting a param with neither a value nor a default (so the sketch's own
 * fallback runs).
 */

export type FigureParamType = "string" | "number" | "boolean";
export type FigureParamValue = string | number | boolean;

export interface FigureParamDecl {
  name: string;
  type: FigureParamType;
  default?: FigureParamValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a card's frontmatter `params` (untyped) into a list of declarations,
 * skipping malformed entries.
 */
export function parseDeclaredParams(value: unknown): FigureParamDecl[] {
  if (!Array.isArray(value)) return [];
  const out: FigureParamDecl[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = item.name;
    const type = item.type;
    if (typeof name !== "string") continue;
    if (type !== "string" && type !== "number" && type !== "boolean") continue;
    const decl: FigureParamDecl = { name, type };
    const def = item.default;
    if (typeof def === "string" || typeof def === "number" || typeof def === "boolean") {
      decl.default = def;
    }
    out.push(decl);
  }
  return out;
}

/** Coerce one supplied string value to the declared type, or undefined if it
 * can't be represented (so the caller falls back to the default). */
function coerceOne(type: FigureParamType, raw: string): FigureParamValue | undefined {
  if (type === "string") return raw;
  if (type === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return undefined;
}

/**
 * Build the `figure.params` object: for each declared param, use the supplied
 * (coerced) value, else the declared default, else omit it entirely.
 */
export function coerceFigureParams(
  declared: FigureParamDecl[],
  raw: Record<string, string>,
): Record<string, FigureParamValue> {
  const out: Record<string, FigureParamValue> = {};
  for (const decl of declared) {
    const supplied = raw[decl.name];
    let value: FigureParamValue | undefined;
    if (supplied !== undefined) value = coerceOne(decl.type, supplied);
    if (value === undefined) value = decl.default;
    if (value !== undefined) out[decl.name] = value;
  }
  return out;
}
