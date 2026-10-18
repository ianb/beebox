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
  for (let k = 0; k < lines.length; k++) {
    if (!/^\s*(?:try|if|switch)\b/.test(lines[k] ?? "")) continue;
    const expr = blockValue(lines.slice(k));
    if (expr !== null && compiles(`${lines.slice(0, k).join("\n")}\n;(${expr}\n);`)) {
      return { setup: lines.slice(0, k), expr, exprIndex: k };
    }
  }
  return null;
}

/**
 * The value of a `try`/`if`/`switch` statement whose blocks end in a bare
 * expression — what authors from expression-oriented languages write:
 *
 *   try { await risky(); } catch (e) { e.message }
 *   => boom
 *
 * A statement has no value in JavaScript, so the blocks are wrapped in an
 * async arrow and each block's final expression becomes its `return`. The
 * result must compile (the caller checks), so a wrong guess costs nothing.
 */
function blockValue(lines: string[]): string | null {
  const out = [...lines];
  let returns = 0;
  for (let i = 0; i < out.length - 1; i++) {
    const line = out[i] ?? "";
    const next = (out[i + 1] ?? "").trim();
    const t = line.trim();
    if (!next.startsWith("}") || t === "" || /[(,;{}]$/.test(t) || /^(?:\/\/|return\b|throw\b|case\b|default\b|else\b|try\b|if\b|for\b|while\b)/.test(t)) continue;
    out[i] = line.replace(t, `return ${t.replace(/;$/, "")};`);
    returns++;
  }
  if (returns === 0) return null;
  return `await (async () => {\n${out.join("\n")}\n})()`;
}

// ── Imports in example blocks ────────────────────────────────────────────────

// A trailing `with { type: "json" }` (or the older `assert { … }`) is carried
// into the dynamic import's options.
const ATTRS = String.raw`(?:\s*(?:with|assert)\s*({[^}]*}))?`;
const IMPORT_RE = new RegExp(String.raw`^(\s*)import\s+(type\s+)?([\S\s]*?)\s*from\s*(["'][^"']+["'])${ATTRS}\s*;?\s*$`);
const BARE_IMPORT_RE = new RegExp(String.raw`^(\s*)import\s*(["'][^"']+["'])${ATTRS}\s*;?\s*$`);

/** The second argument of `import()`, when the static form carried attributes. */
function importOptions(attrs: string | undefined): string {
  return attrs ? `, { with: ${attrs} }` : "";
}

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

/** Whether an import statement that started on this line ends here. */
function importEnds(line: string): boolean {
  return /(["'])[^"']+\1\s*;?\s*$/.test(line) || /(?:with|assert)\s*{[^}]*}\s*;?\s*$/.test(line);
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
    while (end < lines.length - 1 && !importEnds(lines[end] ?? "")) end++;
    const statement = lines.slice(i, end + 1).join("\n");
    const bare = BARE_IMPORT_RE.exec(statement);
    const full = IMPORT_RE.exec(statement);
    let replacement: string | null = null;
    if (bare) replacement = `${bare[1] ?? ""}await import(${bare[2] ?? ""}${importOptions(bare[3])});`;
    else if (full?.[2]) replacement = "";
    else if (full) replacement = `${full[1] ?? ""}${rewriteClause(full[3] ?? "", `${full[4] ?? ""}${importOptions(full[5])}`)}`;
    if (replacement === null) continue;
    lines.splice(i, end - i + 1, replacement, ...Array.from({ length: end - i }, () => ""));
    i = end;
  }
  return lines.join("\n");
}

/**
 * Whether a `/* … *\/` comment is still open after this line. Approximate:
 * a comment marker inside a string counts too, which can only keep an
 * import in place, never move one out of a comment.
 */
function blockCommentOpenAfter(open: boolean, line: string): boolean {
  const lastOpen = line.lastIndexOf("/*");
  const lastClose = line.lastIndexOf("*/");
  if (open) return lastClose === -1 || lastOpen > lastClose;
  return lastOpen !== -1 && lastOpen > lastClose;
}

/**
 * Split module-level code into its static import statements and the rest.
 * Only imports at column 0 outside a template literal count; the rest keeps
 * its lines in order. Moving the imports first changes nothing at run time:
 * static imports are hoisted.
 */
export function splitStaticImports(code: string): { imports: string[]; rest: string } {
  const lines = code.split("\n");
  const imports: string[] = [];
  const rest: string[] = [];
  let inTemplate = false;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (inTemplate || inComment || !/^import[\s"'*{]/.test(line)) {
      rest.push(line);
      inTemplate = nextTemplateState(inTemplate, line);
      inComment = blockCommentOpenAfter(inComment, line);
      continue;
    }
    let end = i;
    while (end < lines.length - 1 && !importEnds(lines[end] ?? "")) end++;
    const statement = lines.slice(i, end + 1).join("\n");
    if (IMPORT_RE.test(statement) || BARE_IMPORT_RE.test(statement)) imports.push(statement);
    else rest.push(...lines.slice(i, end + 1));
    i = end;
  }
  return { imports, rest: rest.join("\n") };
}

/** One name a type-only import binds, in an example block. */
export interface TypeImport {
  /** 0-based line within the code of the name this import binds. */
  offset: number;
  /** The module-scope statement that binds just this name, on one line. */
  statement: string;
  /**
   * Characters to subtract from a column in `statement` to get the column in
   * the author's line: the bound name sits at the same column in both.
   */
  shift: number;
}

/** `A`, `A as B`, `default as B`: one `import type` specifier per name. */
function typeSpecifiers(named: string): string[] {
  return named
    .split(",")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter((p) => p.length > 0);
}

/**
 * The type-only imports that {@link rewriteImports} erases: `import type …`
 * statements, and the `type X` specifiers of a mixed import. Runtime does not
 * need them, but a typecheck does, and an import declaration cannot sit
 * inside the test function, so the typecheck build hoists these to module
 * scope, one statement per bound name.
 */
export function typeOnlyImports(code: string): TypeImport[] {
  if (!/^\s*import[\s"'*{]/m.test(code)) return [];
  const lines = code.split("\n");
  const out: TypeImport[] = [];
  let inTemplate = false;
  for (let i = 0; i < lines.length; i++) {
    const startsInTemplate = inTemplate;
    inTemplate = nextTemplateState(inTemplate, lines[i] ?? "");
    if (startsInTemplate || !/^\s*import[\s"'*{]/.test(lines[i] ?? "")) continue;
    let end = i;
    while (end < lines.length - 1 && !importEnds(lines[end] ?? "")) end++;
    const full = IMPORT_RE.exec(lines.slice(i, end + 1).join("\n"));
    for (let j = i + 1; j <= end; j++) inTemplate = nextTemplateState(inTemplate, lines[j] ?? "");
    const first = i;
    i = end;
    if (!full) continue;
    const clause = (full[3] ?? "").trim().replace(/\s+/g, " ");
    // One spelling of the module, so `"m"` and `'m'` dedupe as one import.
    const source = JSON.stringify((full[4] ?? "").slice(1, -1));
    const brace = /{(.*)}/.exec(clause);
    const outside = clause.replace(/,?\s*{.*}/, "").trim();
    const specifiers = typeSpecifiers(brace?.[1] ?? "");
    const named = full[2] ? specifiers : specifiers.filter((p) => p.startsWith("type ")).map((p) => p.slice("type ".length));
    // Each name keeps its own line and column, so an error on it lands there.
    const place = (spec: string, statement: string): TypeImport => {
      const name = spec.split(" ")[0] ?? spec;
      const pattern = new RegExp(String.raw`(?<=^|[\s,{])${name.replaceAll("$", String.raw`\$`)}\b`);
      for (let k = first; k <= i; k++) {
        const column = (lines[k] ?? "").search(pattern);
        if (column !== -1 && (k > first || /{/.test((lines[k] ?? "").slice(0, column)))) {
          return { offset: k, statement, shift: statement.indexOf(` ${name}`) + 1 - column };
        }
      }
      return { offset: first, statement, shift: 0 };
    };
    for (const spec of named) out.push(place(spec, `import type { ${spec} } from ${source};`));
    // `import type D from` and `import type * as NS from`; a value import's default is not a type import.
    if (full[2] && outside) out.push({ offset: first, statement: `import type ${outside} from ${source};`, shift: 0 });
  }
  return out;
}
