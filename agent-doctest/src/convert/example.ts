/**
 * One doctest example as test-file code: a statement copied, a `=>` as
 * `t.checkText` or (under `upgrade`) `t.check`, a `=> throws` as
 * `t.checkThrows`. Split out of doctest-convert.ts, which assembles files.
 */

import { type Example, type ThrowsExample, nextTemplateState, oracleSplit, rewriteImports, splitExpression } from "../doctest-hooks/hooks.ts";
import { upgradeExpected } from "./upgrade.ts";

/** One example of the doctest, as the manifest records it. */
export interface ManifestExample {
  /** 1-based markdown line of the example's first line; its marker is `// doctest:L<line>`. */
  line: number;
  kind: "check" | "throws" | "statement";
  /** The expected text after `=>` or `=> throws`; null for a statement. */
  expected: string | null;
  /** For a check emitted as `t.check`: its expected value's source. */
  typed?: string;
  /** For a check kept as `t.checkText` under `upgrade`: why. */
  textReason?: string;
}

export interface ConvertOptions {
  filePath: string;
  /** Emit `t.check` for each expected text that reads as a value (doctest-upgrade.ts). */
  upgrade?: boolean;
  /**
   * Doctest lines whose check stays `t.checkText`, with the reason: the typed
   * form failed typecheck or the run, or lint rejects it (a lossy actual
   * value, which phase 3 strengthens).
   */
  textOnly?: ReadonlyMap<number, string>;
  /** Doctest lines whose actual value is a promise, so their `t.check` is awaited. */
  awaited?: ReadonlySet<number>;
  /**
   * Emit each upgradable check as a probe that runs the text check and
   * reports how the typed check compares (the differential test; never
   * committed).
   */
  differential?: boolean;
}

/** What an example emitter needs to know about the file and its options. */
export interface EmitContext {
  md: number;
  oracle: ReadonlySet<number>;
  tName: string;
  out: string | null;
  options: ConvertOptions;
  /** Pattern names the file must import; added to as checks are upgraded. */
  patterns: Set<string>;
  /** Pattern names the doctest's own code declares: a check needing one stays text. */
  taken: ReadonlySet<string>;
}

/**
 * Indent code, except lines that begin inside a multi-line template literal:
 * an indent there would change the string.
 */
export function indent(code: string, by: string): string[] {
  const out: string[] = [];
  let inTemplate = false;
  for (const line of code.split("\n")) {
    out.push(inTemplate || line === "" ? line : `${by}${line}`);
    inTemplate = nextTemplateState(inTemplate, line);
  }
  return out;
}

/**
 * Expected text as a string literal: a quoted string when it is one line,
 * else a template literal with backslashes, backticks, and `${` escaped.
 */
function textLiteral(text: string): string {
  if (!text.includes("\n")) return JSON.stringify(text);
  return `\`${text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")}\``;
}

/** Whether a line may end in a `//` comment, which would swallow a following `,`. */
function mayEndInComment(line: string): boolean {
  return line.includes("//");
}

/** `name(\n  expr,\n  arg,\n)`, or on one line when `expr` is one line. */
function call(opts: { prefix: string; expr: string; arg: string }): string {
  const { prefix, expr, arg } = opts;
  const lines = expr.split("\n");
  if (lines.length === 1 && !mayEndInComment(expr)) return `${prefix}(${expr}, ${arg});`;
  const body = indent(expr, "  ");
  const last = body.length - 1;
  if (mayEndInComment(body[last] ?? "")) body.push("  ,");
  else body[last] = `${body[last]},`;
  return [`${prefix}(`, ...body, `  ${arg},`, ");"].join("\n");
}

/** One example's lines in a test body, and its manifest entry. */
export function emitExample(ex: Example | ThrowsExample, ctx: EmitContext): { marker: string; setup: string; code: string; entry: ManifestExample } {
  const marker = `// doctest:L${ctx.md}`;
  if (ex.expected === null) {
    // ex.source keeps the author's trailing `;`, which the parser strips from the expression.
    return { marker, setup: rewriteImports(ex.source.trimEnd()), code: "", entry: { line: ctx.md, kind: "statement", expected: null } };
  }
  const expression = rewriteImports(ex.expression);
  const split = (ctx.oracle.has(ctx.md) ? oracleSplit(expression) : null) ?? splitExpression(expression);
  const setup = split.setup.join("\n");
  if ("throws" in ex) {
    // Parenthesized as the runtime does: `a, b` is one expression, not two arguments.
    const fn = `async () => (${split.expr})`;
    // checkThrows reads "Name: message" as name and message; the doctest
    // runtime read any ":" that way, so a bare ":" needs the explicit mode.
    const expected = ex.expected.includes(":") && !ex.expected.includes(": ")
      ? `{ expected: ${JSON.stringify(ex.expected)}, mode: "full" }`
      : JSON.stringify(ex.expected);
    return {
      marker,
      setup,
      code: call({ prefix: `await ${ctx.tName}.checkThrows`, expr: fn, arg: expected }),
      entry: { line: ctx.md, kind: "throws", expected: ex.expected },
    };
  }
  const expected = ex.expected;
  const text = { marker, setup, code: "", entry: { line: ctx.md, kind: "check" as const, expected } };
  const textCheck = (reason?: string): typeof text => {
    const actual = ctx.out === null ? split.expr : `${ctx.out}.with(${split.expr})`;
    const entry = reason === undefined ? text.entry : { ...text.entry, textReason: reason };
    return { ...text, entry, code: call({ prefix: `await ${ctx.tName}.checkText`, expr: actual, arg: textLiteral(expected) }) };
  };
  const { options } = ctx;
  if (options.upgrade !== true) return textCheck();
  if (ctx.out !== null) return textCheck("printed output");
  const kept = options.textOnly?.get(ctx.md);
  if (kept !== undefined) return textCheck(kept);
  const upgrade = upgradeExpected(expected);
  if (upgrade.kind === "text") return textCheck(upgrade.reason);
  if ([...upgrade.patterns].some((p) => ctx.taken.has(p))) return textCheck("pattern name taken");
  for (const p of upgrade.patterns) ctx.patterns.add(p);
  const entry = { ...text.entry, typed: upgrade.literal };
  if (options.differential === true) {
    const probe = `{ t: ${ctx.tName}, where: ${JSON.stringify(`${options.filePath}:${ctx.md}`)}, text: ${textLiteral(expected)}, expected: ${upgrade.literal} }`;
    return { ...text, entry, code: call({ prefix: "await __doctestDifferential", expr: split.expr, arg: probe }) };
  }
  const awaitIt = options.awaited?.has(ctx.md) === true ? "await " : "";
  return { ...text, entry, code: call({ prefix: `${awaitIt}${ctx.tName}.check`, expr: split.expr, arg: upgrade.literal }) };
}
