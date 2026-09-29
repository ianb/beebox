/**
 * Turning one example's source lines into "statements, then the checked
 * expression", and making the two things agents most often write in an
 * example block — an `import`, and a `try`/`for`/`if` block before the
 * checked value — just work.
 */

import { transformSync } from "esbuild";
import { nextTemplateState } from "./doctest-parse.ts";

/** An example split into statements and the expression `=>` checks. */
export interface SplitExpression {
  setup: string[];
  expr: string;
  /** Index into the example's lines where `expr` starts. */
  exprIndex: number;
}

/**
 * The line-shape rule: lines up to the last one ending in `;` are statements;
 * the rest is the checked expression. A `;` at the end of a line still inside
 * a template literal is string content, not a boundary.
 *
 * Example:
 *   "const x = foo();\nx.length" → { setup: ["const x = foo();"], expr: "x.length" }
 *   "createTemplate({\n  a: 1,\n})" → { setup: [], expr: "createTemplate({\n  a: 1,\n})" }
 */
export function splitExpression(expression: string): SplitExpression {
  const lines = expression.split("\n");
  if (lines.length === 1) return { setup: [], expr: expression, exprIndex: 0 };

  let lastSemi = -1;
  let inTemplate = false;
  for (const [i, line] of lines.entries()) {
    inTemplate = nextTemplateState(inTemplate, line);
    if (!inTemplate && line.trimEnd().endsWith(";")) lastSemi = i;
  }

  if (lastSemi === -1) return { setup: [], expr: expression, exprIndex: 0 };

  const setup = lines.slice(0, lastSemi + 1);
  const exprPart = lines.slice(lastSemi + 1).join("\n").trim();
  if (!exprPart) {
    // All lines end with ; — the last line is the expression (strip its ;)
    const last = setup.pop() ?? "";
    return { setup, expr: last.replace(/;\s*$/, ""), exprIndex: lastSemi };
  }
  return { setup, expr: exprPart, exprIndex: lastSemi + 1 };
}

function compiles(source: string): boolean {
  try {
    transformSync(`(async () => {\n${source}\n})`, { loader: "ts" });
    return true;
  } catch (_e) {
    // A parse failure is the answer here, not an error to report.
    return false;
  }
}

/**
 * Find the split by asking esbuild, for an example whose line-shape split did
 * not compile. The longest suffix that parses as an expression, with the
 * lines before it parsing as statements, is the checked expression — the
 * same reading JavaScript itself gives a statement list followed by an
 * expression. Returns null when no split compiles (prose in a fence, a typo),
 * so the caller reports the original parse error.
 *
 * Only examples that fail to compile ever reach this, so an example that
 * passes today can never be re-read differently.
 */
export function oracleSplit(expression: string): SplitExpression | null {
  const lines = expression.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const setup = lines.slice(0, k);
    const expr = lines.slice(k).join("\n").trim().replace(/;\s*$/, "");
    if (!expr) continue;
    if (compiles(`${setup.join("\n")}\n;(${expr}\n);`)) return { setup, expr, exprIndex: k };
  }
  return null;
}

// ── Imports in example blocks ────────────────────────────────────────────────

const IMPORT_RE = /^(\s*)import\s+(type\s+)?([\S\s]*?)\s*from\s*(["'][^"']+["'])\s*;?\s*$/;
const BARE_IMPORT_RE = /^(\s*)import\s*(["'][^"']+["'])\s*;?\s*$/;

/** `{ a, b as c, type D }` → `{ a, b: c }` */
function bindingsToPattern(named: string): string {
  const inner = named.trim().replace(/^{/, "").replace(/}$/, "");
  const parts = inner
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith("type "))
    .map((p) => p.replace(/^(\S+)\s+as\s+(\S+)$/, "$1: $2"));
  return parts.join(", ");
}

function rewriteClause(clause: string, source: string): string {
  const spec = clause.trim();
  const ns = /^\*\s+as\s+(\w+)$/.exec(spec);
  if (ns) return `const ${ns[1]} = await import(${source});`;
  const withDefault = /^(\w+)\s*(?:,\s*({[\S\s]*}))?$/.exec(spec);
  if (withDefault) {
    const rest = withDefault[2] ? bindingsToPattern(withDefault[2]) : "";
    return `const { default: ${withDefault[1]}${rest ? `, ${rest}` : ""} } = await import(${source});`;
  }
  return `const { ${bindingsToPattern(spec)} } = await import(${source});`;
}

/**
 * Rewrite static `import` statements in an example to `await import()`, in
 * place, so they run in the order they are written. (Hoisting them to module
 * scope would run them before the example code above them.) A multi-line
 * import is rewritten onto its first line and the rest become blank lines, so
 * line numbers stay put. `import type` disappears; types are erased anyway.
 */
export function rewriteImports(expression: string): string {
  if (!/^\s*import[\s"'*{]/m.test(expression)) return expression;
  const lines = expression.split("\n");
  // Lines that begin inside a multi-line template literal are string content
  // (a view or script the example writes to disk), never an import to rewrite.
  const startsInTemplate: boolean[] = [];
  let inTemplate = false;
  for (const line of lines) {
    startsInTemplate.push(inTemplate);
    inTemplate = nextTemplateState(inTemplate, line);
  }
  for (let i = 0; i < lines.length; i++) {
    if (startsInTemplate[i] || !/^\s*import[\s"'*{]/.test(lines[i] ?? "")) continue;
    let end = i;
    while (end < lines.length - 1 && !/(["'])[^"']+\1\s*;?\s*$/.test(lines[end] ?? "")) end++;
    const statement = lines.slice(i, end + 1).join("\n");
    const bare = BARE_IMPORT_RE.exec(statement);
    const full = IMPORT_RE.exec(statement);
    let replacement: string | null = null;
    if (bare) replacement = `${bare[1] ?? ""}await import(${bare[2] ?? ""});`;
    else if (full?.[2]) replacement = "";
    else if (full) replacement = `${full[1] ?? ""}${rewriteClause(full[3] ?? "", full[4] ?? "")}`;
    if (replacement === null) continue;
    lines.splice(i, end - i + 1, replacement, ...Array.from({ length: end - i }, () => ""));
    i = end;
  }
  return lines.join("\n");
}
