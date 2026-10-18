/**
 * Convert one `.doctest.md` file to one tap `.test.ts` file with the same
 * behavior, plus a fidelity manifest of its examples.
 *
 * The conversion is mechanical. Every `=>` becomes a `t.checkText` with the
 * same expected text, every `=> throws` a `t.checkThrows`, and every other
 * line of code is copied. A `// doctest:L<n>` comment marks each example,
 * so a later edit can be checked against the manifest. What the doctest
 * runtime adds around the author's code is reproduced where it changes a
 * result, and dropped where it only adds a diagnostic:
 *
 * - Setup blocks run at module level, before every test, in file order.
 * - A plain block and its `continue` blocks are one `test(...)`.
 * - `cleanup` blocks register a `t.teardown` at the start of their test;
 *   `teardown` blocks register a teardown on tap's root test.
 * - `print()` and `eventually` come from `agent-doctest/check`.
 * - Dropped: the still-running notice, and the ReferenceError hint.
 *
 * Plan: beebox/docs/plans/retire-doctest.md, track 2.
 */

import { bracketBalance, type CodeBlock, parseCodeBlocks, parseExamples, type Example, type ThrowsExample } from "./doctest-parse.ts";
import { parseFenceInfo, type FenceInfo } from "./doctest-info.ts";
import { doctestOracle } from "./doctest-load.ts";
import { oracleSplit, rewriteImports, splitExpression, typeOnlyImports } from "./doctest-split.ts";
import { blockDeclarations, declaresName } from "./doctest-runtime.ts";
import { nextTemplateState } from "./doctest-parse.ts";

/** One example of the doctest, as the manifest records it. */
export interface ManifestExample {
  /** 1-based markdown line of the example's first line; its marker is `// doctest:L<line>`. */
  line: number;
  kind: "check" | "throws" | "statement";
  /** The expected text after `=>` or `=> throws`; null for a statement. */
  expected: string | null;
}

export interface Manifest {
  doctest: string;
  examples: ManifestExample[];
}

export interface Conversion {
  source: string;
  manifest: Manifest;
}

/** A doctest the converter cannot turn into an equivalent test file. */
export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

interface Classified {
  block: CodeBlock;
  info: FenceInfo;
  /** The prose (and non-code fences) just before this block, as comment lines. */
  prose: string[];
  /** The nearest heading above the block, other than the file's `#` title. */
  heading: string | null;
}

/** An example waiting to be emitted, once its test's whole text is known. */
interface ExampleRef {
  ex: Example | ThrowsExample;
  /** 1-based markdown line of the example. */
  md: number;
}

/** A cleanup block: registered as a `t.teardown` at the start of its test. */
interface Cleanup {
  prose: string[];
  code: string;
}

interface OpenTest {
  name: string;
  prose: string[];
  timeoutMs: number | null;
  teardowns: Cleanup[];
  /** Prose comment lines and examples, in file order. */
  body: Array<string | ExampleRef>;
}

/** The author's text of a test body entry. */
function textOf(entry: string | ExampleRef): string {
  return typeof entry === "string" ? entry : entry.ex.source;
}

/** Lines as `//` comments; blank lines inside the run become `//`. */
function commentLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start++;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(start, end).map((l) => (l.trim() === "" ? "//" : `// ${l.trimEnd()}`));
}

/**
 * Indent code, except lines that begin inside a multi-line template literal:
 * an indent there would change the string.
 */
function indent(code: string, by: string): string[] {
  const out: string[] = [];
  let inTemplate = false;
  for (const line of code.split("\n")) {
    out.push(inTemplate || line === "" ? line : `${by}${line}`);
    inTemplate = nextTemplateState(inTemplate, line);
  }
  return out;
}

/** Text as a template literal: backslashes, backticks, and `${` escaped. */
function templateLiteral(text: string): string {
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

/** The first sentence of some prose, cut to 80 characters. */
function firstSentence(prose: string[]): string | null {
  const text = prose
    .map((l) => l.replace(/^\/\/ ?/, "").trim())
    .filter((l) => l !== "" && !l.startsWith("```") && !l.startsWith("#"))
    .join(" ");
  if (text === "") return null;
  const sentence = (/^(.*?[!.:?])(?:\s|$)/.exec(text)?.[1] ?? text).replace(/[*_`]/g, "");
  return sentence.length > 80 ? `${sentence.slice(0, 77).trimEnd()}...` : sentence;
}

/** Split the markdown into code blocks, each with the prose and heading before it. */
function classify(markdown: string): { blocks: Classified[]; trailing: string[]; title: string[] } {
  const lines = markdown.split("\n");
  const codeBlocks = parseCodeBlocks(markdown);
  const out: Classified[] = [];
  let cursor = 0;
  let heading: string | null = null;
  const take = (to: number): string[] => {
    const run = lines.slice(cursor, to);
    for (const l of run) {
      const h = /^#{2,6}\s+(.*)$/.exec(l);
      if (h?.[1]) heading = h[1].trim();
    }
    return run;
  };
  for (const block of codeBlocks) {
    const fence = block.line - 2;
    const info = parseFenceInfo(block.info);
    const end = block.line - 1 + (block.content === "" ? 0 : block.content.split("\n").length);
    if (info.kind === "prose") continue; // stays in the prose run, fences and all
    const prose = take(fence);
    out.push({ block, info, prose: commentLines(prose), heading });
    cursor = end + 1;
  }
  const trailing = commentLines(take(lines.length));
  // The title and opening prose are the file header. When the first block
  // is an example, the last paragraph before it stays with it: that one
  // says what the example shows.
  const first = out[0];
  if (!first) return { blocks: out, trailing, title: [] };
  const lastBreak = first.info.kind === "example" ? first.prose.lastIndexOf("//") : -1;
  const title = lastBreak === -1 ? first.prose : first.prose.slice(0, lastBreak);
  first.prose = lastBreak === -1 ? [] : first.prose.slice(lastBreak + 1);
  return { blocks: out, trailing, title };
}

/** One example's lines in a test body, and its manifest entry. */
function emitExample(ex: Example | ThrowsExample, ctx: { md: number; oracle: ReadonlySet<number>; tName: string; out: string | null }): { marker: string; setup: string; code: string; entry: ManifestExample } {
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
  const actual = ctx.out === null ? split.expr : `${ctx.out}.with(${split.expr})`;
  return {
    marker,
    setup,
    code: call({ prefix: `await ${ctx.tName}.checkText`, expr: actual, arg: templateLiteral(ex.expected) }),
    entry: { line: ctx.md, kind: "check", expected: ex.expected },
  };
}

/** A name the runtime binds unless setup declares it; the converted file must bind it the same way. */
function uses(code: string, name: string): boolean {
  return new RegExp(String.raw`(?<![\w$.])${name.replace("$", String.raw`\$`)}\b`).test(code);
}

export function convertDoctest(markdown: string, opts: { filePath: string }): Conversion {
  // Validates the file as the loader does (indented fences, bad directives,
  // vacuous wildcards, an orphan continue) and gives the esbuild splits.
  const oracle = doctestOracle(markdown, opts.filePath);
  const { blocks, trailing, title } = classify(markdown);
  const setupText = blocks.filter((b) => b.info.kind === "setup").map((b) => b.block.content).join("\n");
  const setupDeclares = (name: string): boolean => declaresName(setupText, name);
  // tap's `test` and `after` are imported under another name when setup already uses the name.
  const testName = setupDeclares("test") ? "tapTest" : "test";
  const tapImport = (name: string, local: string): string => (name === local ? name : `${name} as ${local}`);
  // Names the converter introduces must not collide with a name the
  // doctest's own code declares in any block.
  const authorText = blocks.map((b) => b.block.content).join("\n");
  const taken = new Set(blocks.flatMap((b) => blockDeclarations(b.block.content)));
  const fresh = (base: string): string => {
    let name = base;
    for (let n = 2; taken.has(name) || uses(authorText, name); n++) name = `${base}${n}`;
    taken.add(name);
    return name;
  };
  // Each test is its own scope, so one name serves every test that prints.
  const outName = fresh("out");
  const tName = setupDeclares("t") ? fresh("tap") : "t";
  // A teardown block registers on tap's root test, as the runtime did. tap's
  // exported after() would wait for the root test to end, which a server the
  // file keeps open prevents.
  const rootName = fresh(tName === "tap" ? "tapRoot" : "tap");
  const printedName = fresh("printed");
  const examples: ManifestExample[] = [];

  const setupLines: string[] = [];
  const typeImports = new Set<string>();
  const afters: string[] = [];
  const tests: OpenTest[] = [];
  let open: OpenTest | null = null;
  let pendingCleanup: Cleanup[] = [];
  const usedNames = new Map<string, number>();

  for (const { block, info, prose, heading } of blocks) {
    const content = block.content;
    if (info.kind === "setup") {
      setupLines.push(...prose, content, "");
      continue;
    }
    if (info.kind === "teardown") {
      for (const t of typeOnlyImports(content)) typeImports.add(t.statement);
      // As the runtime does (doctest-runtime.ts teardownRegistration): a
      // failing teardown is reported and fails the run, and the others still run.
      afters.push(
        ...prose,
        `${rootName}.teardown(async () => {`,
        "  try {",
        ...indent(rewriteImports(content), "    "),
        "  } catch (error) {",
        '    console.error("teardown failed:", error);',
        "    process.exitCode = 1;",
        "  }",
        "});",
        "",
      );
      continue;
    }
    if (info.kind === "prose") continue;
    for (const t of typeOnlyImports(content)) typeImports.add(t.statement);
    if (info.kind === "cleanup" || info.kind === "continue-cleanup") {
      const registration = { prose, code: rewriteImports(content) };
      if (open) open.teardowns.push(registration);
      else pendingCleanup.push(registration);
      continue;
    }
    const parsed = parseExamples(content).filter((ex) => ex.expression !== "");
    if (parsed.length === 0) continue;
    if (info.kind === "example") {
      // The prose just before a block says what it shows; a heading often
      // covers several blocks.
      const base = firstSentence(prose) ?? heading ?? `line ${block.line - 1}`;
      const seen = usedNames.get(base) ?? 0;
      usedNames.set(base, seen + 1);
      open = { name: seen === 0 ? base : `${base} (line ${block.line - 1})`, prose, timeoutMs: info.timeoutMs, teardowns: pendingCleanup, body: [] };
      pendingCleanup = [];
      tests.push(open);
    } else if (open && prose.length > 0) {
      open.body.push("", ...prose);
    }
    if (!open) throw new ConvertError(`the continue block at line ${block.line - 1} has no test to continue`);
    for (const ex of parsed) open.body.push({ ex, md: block.line + ex.lineOffset });
  }

  // Second pass: tests know their whole text now, so print() can be bound.
  const testLines: string[] = [];
  for (const test of tests) {
    const text = [...test.body.map(textOf), ...test.teardowns.map((c) => c.code)].join("\n");
    const out = !setupDeclares("print") && uses(text, "print") ? outName : null;
    const body: string[] = [];
    if (out !== null) body.push(`const ${out} = ${printedName}();`, `const print = ${out}.print;`);
    for (const { prose, code } of test.teardowns) {
      body.push(...prose, `${tName}.teardown(async () => {`, "  try {", ...indent(code, "    "), "  } catch (error) {", `    ${tName}.error(error);`, "  }", "});");
    }
    // A statement example may be the first half of a statement that
    // continues past a blank line. Its marker waits until the statement's
    // brackets close, so no marker sits inside a statement.
    let depth = 0;
    let deferred: string[] = [];
    let first = true;
    for (const r of test.body) {
      if (typeof r === "string") {
        body.push(r);
        continue;
      }
      const { marker, setup, code, entry } = emitExample(r.ex, { md: r.md, oracle, tName, out });
      examples.push(entry);
      if (!first) body.push("");
      first = false;
      if (depth > 0) deferred.push(marker);
      else body.push(marker);
      if (setup !== "") {
        body.push(setup);
        depth += bracketBalance(setup.split("\n"));
      }
      if (depth <= 0) {
        body.push(...deferred);
        deferred = [];
        depth = 0;
      }
      if (code !== "") body.push(code);
    }
    body.push(...deferred);
    testLines.push(...test.prose);
    if (test.timeoutMs !== null) testLines.push(`// The doctest gave each example ${test.timeoutMs / 1000}s before a still-running notice.`);
    testLines.push(`void ${testName}(${JSON.stringify(test.name)}, async (${tName}) => {`, ...indent(body.join("\n"), "  "), "});", "");
  }

  const allCode = [setupText, ...tests.flatMap((tt) => [...tt.body.map(textOf), ...tt.teardowns.map((c) => c.code)])].join("\n");
  const helpers: string[] = [];
  if (!setupDeclares("eventually") && uses(allCode, "eventually")) helpers.push("eventually");
  if (testLines.some((l) => l.trim().endsWith(`= ${printedName}();`))) helpers.push(tapImport("printed", printedName));
  const imports = [`import ${afters.length > 0 ? `${rootName}, ` : ""}{ ${tapImport("test", testName)} } from "tap";`];
  if (helpers.length > 0) imports.push(`import { ${helpers.join(", ")} } from "agent-doctest/check";`);
  imports.push(...typeImports);

  const parts = [title.join("\n"), imports.join("\n"), setupLines.join("\n").trimEnd(), afters.join("\n").trimEnd(), testLines.join("\n").trimEnd(), trailing.join("\n")]
    .filter((p) => p.trim() !== "");
  return {
    source: `${parts.join("\n\n")}\n`,
    manifest: { doctest: opts.filePath, examples },
  };
}

