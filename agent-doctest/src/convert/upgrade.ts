/**
 * The upgrade from a doctest's expected text to a typed `t.check` expected
 * value: `{ id: «uuid», n: 3 }` becomes `{ id: uuid(), n: 3 }`.
 *
 * Only the text decides the literal; whether it fits the actual value is
 * decided later, by the type checker and by running the test. A check whose
 * literal fails either stays a `t.checkText` (the converter's `textOnly`).
 *
 * Plan: beebox/docs/plans/retire-doctest.md, tracks 2 and 5.
 */

import { Source, render } from "../check/compare/report.ts";
import { LiteralWildcard, parseLiteral } from "../tap-check/text/compare.ts";
import { WILDCARD_SPLIT, parseWildcardToken } from "../tap-check/wildcards.ts";

/** Why an expected text stays a text check, by kind; the counts are the API's gaps. */
export type KeepTextReason =
  | "multi-line text"
  | "show"
  | "wildcard as the whole value"
  | "wildcard type not expressible"
  | "printed output"
  | "structure that is not a literal";

export type Upgrade =
  | { kind: "typed"; literal: string; patterns: ReadonlySet<string> }
  | { kind: "text"; reason: KeepTextReason };

/** A wildcard token's type: `«at=date»` and `«date»` are both "date". */
function wildcardType(token: string): string {
  return parseWildcardToken(token.slice(1, -1)).type;
}

/**
 * The pattern a whole-value wildcard becomes, or null when none fits.
 *
 * Known, accepted widening (cross-model review, 2026-10-18): `uuid()`
 * accepts an uppercase UUID where the text wildcard was lowercase-only, and
 * `.int()` accepts 1e21, which JSON prints in exponent form. Neither occurs
 * in values the code under test produces (randomUUID is lowercase).
 */
function valuePattern(token: string, patterns: Set<string>): string | null {
  switch (wildcardType(token)) {
    case "int":
      patterns.add("any");
      return "any(Number).int()";
    case "number":
      patterns.add("any");
      return "any(Number)";
    case "uuid":
      patterns.add("uuid");
      return "uuid()";
    case "date":
      patterns.add("isoDate");
      return "isoDate()";
    case "string":
      patterns.add("any");
      return "any(String)";
    case "*":
      patterns.add("anything");
      return "anything()";
    default:
      return null;
  }
}

/** The string pattern a wildcard inside a string becomes, or null when none fits. */
function holePattern(token: string, patterns: Set<string>): string | null {
  switch (wildcardType(token)) {
    case "uuid":
      patterns.add("uuid");
      return "uuid()";
    case "date":
      patterns.add("isoDate");
      return "isoDate()";
    case "int":
      patterns.add("any");
      return String.raw`any(String).matches(/^-?\d+$/)`;
    case "number":
      patterns.add("any");
      return String.raw`any(String).matches(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/)`;
    case "*":
      patterns.add("any");
      return "any(String)";
    default:
      return null;
  }
}

/** Escape literal text for a template literal's body. */
function templateText(text: string): string {
  return text.replace(/[\\`]/g, "\\$&").replace(/\${/g, "\\${");
}

/** A string with `«»` wildcards as a `str` template, or null when a hole has no pattern. */
function strTemplate(text: string, patterns: Set<string>): string | null {
  const parts = text.split(WILDCARD_SPLIT);
  let out = "";
  for (const [i, part] of parts.entries()) {
    if (i % 2 === 0) {
      out += templateText(part);
      continue;
    }
    const hole = holePattern(part, patterns);
    if (hole === null) return null;
    out += `\${${hole}}`;
  }
  patterns.add("str");
  return `str\`${out}\``;
}

const UNEXPRESSIBLE = Symbol("unexpressible");

/** Replace wildcards with pattern sources; UNEXPRESSIBLE when one has no pattern. */
function withPatterns(value: unknown, patterns: Set<string>): unknown {
  if (value instanceof LiteralWildcard) {
    const pattern = valuePattern(value.token, patterns);
    return pattern === null ? UNEXPRESSIBLE : new Source(pattern);
  }
  if (typeof value === "string") {
    if (!value.includes("«")) return value;
    const template = strTemplate(value, patterns);
    return template === null ? UNEXPRESSIBLE : new Source(template);
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => withPatterns(v, patterns));
    return items.includes(UNEXPRESSIBLE) ? UNEXPRESSIBLE : items;
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const item = withPatterns(v, patterns);
      if (item === UNEXPRESSIBLE) return UNEXPRESSIBLE;
      Object.defineProperty(out, k, { value: item, enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

/** Bare one-line text that is no literal: the actual value's text, so a string. */
const BARE_WORDS: Record<string, string> = { undefined: "undefined", NaN: "NaN" };

export function upgradeExpected(text: string): Upgrade {
  if (text.trim() === "«show»") return { kind: "text", reason: "show" };
  const patterns = new Set<string>();
  const parsed = parseLiteral(text);
  if (parsed === null) {
    if (text.includes("\n")) return { kind: "text", reason: "multi-line text" };
    // A Map, a class's text, or a wildcard key: structure, not a string.
    if (/^[[{]|^\w+(?:\(\d+\))? {/.test(text)) return { kind: "text", reason: "structure that is not a literal" };
    const bare = BARE_WORDS[text];
    if (bare !== undefined) return { kind: "typed", literal: bare, patterns };
    if (/^«[^»]*»$/.test(text)) return { kind: "text", reason: "wildcard as the whole value" };
    if (!text.includes("«")) return { kind: "typed", literal: JSON.stringify(text), patterns };
    const template = strTemplate(text, patterns);
    return template === null ? { kind: "text", reason: "wildcard type not expressible" } : { kind: "typed", literal: template, patterns };
  }
  if (parsed.value instanceof LiteralWildcard) return { kind: "text", reason: "wildcard as the whole value" };
  const value = withPatterns(parsed.value, patterns);
  if (value === UNEXPRESSIBLE) return { kind: "text", reason: "wildcard type not expressible" };
  return { kind: "typed", literal: render(value), patterns };
}

/** Where each top-level argument of a call's argument list ends; quotes and brackets are skipped. */
function topLevelArgs(args: string): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i] ?? "";
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      out.push(args.slice(start, i).trim());
      start = i + 1;
    }
    if (depth < 0) return null;
  }
  if (quote !== null || depth !== 0) return null;
  out.push(args.slice(start).trim());
  return out;
}

/**
 * `JSON.stringify(x)` or `JSON.stringify(x, null, n)` as the checked
 * expression: the typed check compares `x` itself, and `textOf` rebuilds the
 * text the doctest compared (for the differential test). Null for anything
 * else, including a replacer.
 */
export function unwrapStringify(expr: string): { inner: string; textOf: string } | null {
  const s = expr.trim();
  const prefix = "JSON.stringify(";
  if (!s.startsWith(prefix) || !s.endsWith(")")) return null;
  const args = topLevelArgs(s.slice(prefix.length, -1));
  if (args === null) return null;
  const [inner, replacer, indent] = args;
  if (inner === undefined || inner === "") return null;
  if (args.length === 1) return { inner, textOf: "(v) => JSON.stringify(v)" };
  if (args.length === 3 && replacer === "null" && /^\d+$/.test(indent ?? "")) {
    return { inner, textOf: `(v) => JSON.stringify(v, null, ${indent ?? ""})` };
  }
  return null;
}
