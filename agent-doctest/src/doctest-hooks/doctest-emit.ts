/**
 * Emitting one block's examples as generated lines, each tagged with the
 * markdown line it came from (see line-map.ts).
 */

import { basename } from "node:path";
import { nextTemplateState, type Example, type ThrowsExample } from "./doctest-parse.ts";
import { rewriteImports, splitExpression, oracleSplit } from "./doctest-split.ts";
import type { GenLine } from "./line-map.ts";

/** Where an example sits in the markdown, for placing a parse error. */
export interface ExampleSpan {
  /** 1-based first and last markdown lines of the example. */
  start: number;
  end: number;
  hasExpected: boolean;
}

export interface EmitContext {
  filePath: string;
  blockLine: number;
  /** Markdown lines of examples whose split must come from esbuild. */
  oracle: ReadonlySet<number>;
  /** How long an example may run before the still-running notice. */
  timeoutMs: number;
  /** Collects every emitted example's span. */
  spans: ExampleSpan[];
}

/** A generated line with no markdown origin. */
export function gen(text: string): GenLine {
  return { text, md: null, col: 0 };
}

/**
 * Author text, one generated line per markdown line, with a cosmetic indent —
 * except lines that begin inside a multi-line template literal, which must be
 * emitted verbatim: an injected indent there silently changes the string.
 */
export function verbatim(text: string, opts: { md: number | null; indent: string }): GenLine[] {
  const out: GenLine[] = [];
  let inTemplate = false;
  for (const [i, line] of text.split("\n").entries()) {
    const indent = inTemplate ? "" : opts.indent;
    out.push({ text: `${indent}${line}`, md: opts.md === null ? null : opts.md + i, col: indent.length });
    inTemplate = nextTemplateState(inTemplate, line);
  }
  return out;
}

/** An author expression wrapped in generated code on its first and last lines. */
function wrapped(expr: string, opts: { md: number; prefix: string; suffix: string }): GenLine[] {
  const lines = verbatim(expr, { md: opts.md, indent: "" });
  const first = lines[0];
  const last = lines.at(-1);
  if (first) {
    first.text = `${opts.prefix}${first.text}`;
    first.col = opts.prefix.length;
  }
  if (last) last.text = `${last.text}${opts.suffix}`;
  return lines;
}

export function emitExamples(examples: Array<Example | ThrowsExample>, ctx: EmitContext): GenLine[] {
  const indent = "  ";
  const out: GenLine[] = [];
  // An example with no `=>` may be half of a statement that continues past a
  // blank line (an object literal with a blank line in it), so nothing
  // generated may go between it and the next example.
  let atBoundary = true;
  for (const ex of examples) {
    if (!ex.expression) continue;
    const md = ctx.blockLine + ex.lineOffset;
    ctx.spans.push({ start: md, end: md + ex.source.split("\n").length - 1, hasExpected: ex.expected !== null });
    const firstLine = (ex.expression.split("\n")[0] ?? "").trim();
    if (atBoundary) {
      out.push(gen(`${indent}__doctest_watch.mark(${JSON.stringify(`${basename(ctx.filePath)}:${md} ${firstLine}`)}, ${ctx.timeoutMs});`));
    }
    atBoundary = ex.expected !== null;
    const expression = rewriteImports(ex.expression);
    if (ex.expected === null) {
      out.push(...verbatim(expression, { md, indent }));
      continue;
    }
    const split = (ctx.oracle.has(md) ? oracleSplit(expression) : null) ?? splitExpression(expression);
    if (split.setup.length > 0) out.push(...verbatim(split.setup.join("\n"), { md, indent }));
    const exprMd = md + split.exprIndex;
    const diagnostic = JSON.stringify({
      at: { fileName: ctx.filePath, lineNumber: md, columnNumber: 1 },
      source: `${ex.source}\n`,
    });
    if ("throws" in ex) {
      const mode = ex.expected.includes(":") ? "full" : "name";
      out.push(...wrapped(split.expr, {
        md: exprMd,
        prefix: `${indent}await __doctest_t.checkThrows(async () => (`,
        suffix: `), { expected: ${JSON.stringify(ex.expected)}, mode: ${JSON.stringify(mode)}, diagnostic: ${diagnostic} });`,
      }));
    } else {
      const exprFirst = (split.expr.split("\n")[0] ?? "").trim();
      const check = JSON.stringify({ expected: ex.expected, label: `line ${exprMd}: ${exprFirst}` });
      out.push(...wrapped(split.expr, {
        md: exprMd,
        prefix: `${indent}await __doctest_t.check(__doctest_withPrints(__doctest_prints, `,
        suffix: `), { check: ${check}, diagnostic: ${diagnostic} });`,
      }));
    }
  }
  return out;
}
