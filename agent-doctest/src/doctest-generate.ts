/**
 * Generates the tap test module source that doctest-hooks.ts's `load()` hook
 * feeds to esbuild, from the code blocks and examples doctest-parse.ts parses
 * out of a `.doctest.md` file.
 *
 * Split out of doctest-hooks.ts (the actual Node module-customization hook
 * Node imports) purely to keep that file to the loader hooks themselves;
 * this module has no Node loader responsibilities.
 */

import { basename } from "node:path";
import {
  type CodeBlock,
  parseCodeBlocks,
  nextTemplateState,
  type Example,
  type ThrowsExample,
  parseExamples,
} from "./doctest-parse.ts";

export {
  type CodeBlock,
  parseCodeBlocks,
  type Example,
  type ThrowsExample,
  parseExamples,
  parseExample,
} from "./doctest-parse.ts";

/**
 * Split a multi-line expression into setup statements and a check expression.
 *
 * Lines ending with `;` are setup statements. The remaining lines
 * (from the last `;`-terminated line onward) form the expression to check.
 *
 * Example:
 *   "const x = foo();\nx.length" → { setup: ["const x = foo();"], expr: "x.length" }
 *   "createTemplate({\n  a: 1,\n})" → { setup: [], expr: "createTemplate({\n  a: 1,\n})" }
 */
interface SplitExpression {
  setup: string[];
  expr: string;
}

function splitExpression(expression: string): SplitExpression {
  const lines = expression.split("\n");
  if (lines.length === 1) {
    return { setup: [], expr: expression };
  }

  // Find the last line ending with ; — but a `;` at the end of a line
  // that's still inside a template literal is string content, not a
  // statement boundary.
  let lastSemi = -1;
  let inTemplate = false;
  for (const [i, line] of lines.entries()) {
    inTemplate = nextTemplateState(inTemplate, line);
    if (!inTemplate && line.trimEnd().endsWith(";")) {
      lastSemi = i;
    }
  }

  if (lastSemi === -1) {
    // No semicolons — whole thing is one expression
    return { setup: [], expr: expression };
  }

  const setup = lines.slice(0, lastSemi + 1);
  const exprPart = lines.slice(lastSemi + 1).join("\n").trim();

  if (!exprPart) {
    // All lines end with ; — last line is the expression (strip trailing ;)
    const last = setup.pop() ?? "";
    return { setup, expr: last.replace(/;\s*$/, "") };
  }

  return { setup, expr: exprPart };
}

/**
 * Push source lines with a cosmetic indent — except lines that begin
 * inside a multi-line template literal, which must be emitted verbatim:
 * an injected indent there silently changes the string's content.
 */
function emitLines(lines: string[] | string, indent: string): string[] {
  const list = Array.isArray(lines) ? lines : lines.split("\n");
  const out: string[] = [];
  let inTemplate = false;
  for (const line of list) {
    out.push(inTemplate ? line : `${indent}${line}`);
    inTemplate = nextTemplateState(inTemplate, line);
  }
  return out;
}

/** Where in the file the emitted examples came from, plus their indent. */
interface EmitExamplesContext {
  filePath: string;
  blockLine: number;
  indent?: string;
}

/**
 * Emit examples as generated source lines (shared by normal and continue
 * blocks).
 */
function emitExamples(
  examples: Array<Example | ThrowsExample>,
  context: EmitExamplesContext,
): string[] {
  const { filePath, blockLine, indent = "  " } = context;
  const out: string[] = [];
  for (const ex of examples) {
    if (!ex.expression) continue;

    const diagnostic = JSON.stringify({
      at: {
        fileName: filePath,
        lineNumber: blockLine + ex.lineOffset,
        columnNumber: 1,
      },
      source: `${ex.source}\n`,
    });

    if ("throws" in ex) {
      const { setup, expr } = splitExpression(ex.expression);
      out.push(...emitLines(setup, indent));
      const mode = ex.expected.includes(":") ? "full" : "name";
      // Async arrow + await so `=> throws` works on await-containing
      // expressions (rejections and sync throws both land in checkThrows).
      out.push(`${indent}await t.checkThrows(async () => (${expr}), { expected: ${JSON.stringify(ex.expected)}, mode: ${JSON.stringify(mode)}, diagnostic: ${diagnostic} });`);
    } else if (ex.expected !== null) {
      const { setup, expr } = splitExpression(ex.expression);
      out.push(...emitLines(setup, indent));
      out.push(`${indent}await t.check(__withPrints(__prints, ${expr}), { check: ${JSON.stringify(ex.expected)}, diagnostic: ${diagnostic} });`);
    } else {
      // No assertion — just run the statements
      out.push(...emitLines(ex.expression, indent));
    }
  }
  return out;
}

/**
 * Generate a tap test module source from parsed markdown.
 *
 * Each code block becomes one test function. Examples within a block
 * share scope, so variables declared in one example are visible to later ones.
 * This enables "story" style tests where state builds up across assertions.
 *
 * Blocks with `continue` in their info string (e.g., ```ts continue or
 * ``` continue) append to the previous test function, allowing prose
 * between code sections that share variables.
 *
 * Blocks with `cleanup` in their info string declare cleanup code that
 * runs after the current test (and any continue blocks) in a finally block.
 * Cleanup applies from the point it's declared until a new non-continue
 * test begins.
 */
export function generateTestSource(markdown: string, filePath: string): string {
  const blocks: CodeBlock[] = parseCodeBlocks(markdown);

  const fileName = basename(filePath);
  const out: string[] = [];

  out.push('import { test } from "tap";');
  // Trim trailing newlines from string results — doctest expected values
  // can't express trailing newlines since code blocks naturally trim them.
  out.push("function __trim(v) { return typeof v === 'string' ? v.replace(/\\n+$/, '') : v; }");
  // Drain accumulated print() lines and combine with expression result.
  // When no prints accumulated, falls through to __trim (same as before).
  out.push("function __withPrints(prints, value) {");
  out.push("  if (prints.length === 0) return __trim(value);");
  out.push("  const lines = prints.splice(0);");
  out.push("  if (value !== undefined && value !== null) {");
  out.push("    if (typeof value === 'string') { lines.push(value.replace(/\\n+$/, '')); }");
  out.push("    else { try { lines.push(JSON.stringify(value, null, 2)); } catch { lines.push(String(value)); } }");
  out.push("  }");
  out.push("  return lines.join('\\n');");
  out.push("}");
  out.push("");

  // Insert setup blocks at module scope
  for (const block of blocks) {
    if (!block.info.includes("setup")) continue;
    out.push(`// --- setup (${fileName}:${block.line}) ---`);
    out.push(block.content);
    out.push("");
  }

  // Generate test cases from example blocks
  // All examples in a block share one test scope (variables persist)
  // "continue" blocks append to the previous test scope
  // "cleanup" blocks register teardown via t.teardown()
  let testOpen = false;
  let pendingCleanup: string[] = []; // cleanup lines waiting for a test to attach to
  // The open test's pieces, buffered so every `t.teardown()` registration can
  // be emitted AHEAD of the body. Registering them inline — where the cleanup
  // block appears in the document — means a throwing example never reaches the
  // registration, so the cleanup never runs. A doctest that holds an OS handle
  // (an `fs.watch`, a server, a child process) then keeps the tap child alive
  // forever, and a single failed assertion surfaces as an opaque whole-file
  // `expired:` at tap's timeout instead of naming the assertion that failed.
  // That is what made `file-watcher.doctest.md` unreadable across three rounds
  // of flake investigation
  // (`issues/bugs/2026-08-06-file-watcher-doctest-suite-timeout.md`).
  let testHeader: string[] = [];
  let testBody: string[] = [];
  let testTeardowns: string[][] = [];

  /** Register one cleanup block as a teardown of the open test. */
  function addTeardown(lines: string[]): void {
    testTeardowns.push(lines);
  }

  function closeTest(): void {
    if (!testOpen) return;
    out.push(...testHeader);
    for (const lines of testTeardowns) {
      out.push("  t.teardown(async () => {");
      out.push("    try {");
      out.push(...emitLines(lines, "      "));
      // tap runs teardowns LIFO and abandons the rest once one throws, so one
      // cleanup that cannot run would skip every earlier cleanup and leak
      // exactly the handles they exist to release. That is reachable now that
      // registration is hoisted: a cleanup whose `continue` block never ran
      // references a `const` still in its temporal dead zone. Report the
      // failure as an assertion instead — visible, and it strands nothing.
      out.push("    } catch (__cleanupError) {");
      // console.error names it (tap has usually closed the test's plan by
      // teardown time, so its own diagnostic degrades to a generic "assertion
      // after Promise resolution"); t.error is what still turns it into a
      // non-zero exit.
      out.push("      console.error(\"doctest cleanup block failed:\", __cleanupError);");
      out.push("      t.error(__cleanupError, \"doctest cleanup block failed\");");
      out.push("    }");
      out.push("  });");
    }
    out.push(...testBody);
    out.push("});");
    out.push("");
    testOpen = false;
    testHeader = [];
    testBody = [];
    testTeardowns = [];
  }

  for (const block of blocks) {
    if (block.info.includes("setup")) continue;

    const isContinue = block.info.includes("continue");
    const isCleanup = block.info.includes("cleanup");

    if (isCleanup) {
      if (testOpen) {
        addTeardown(block.content.split("\n"));
      } else {
        // Save for the next test
        for (const line of block.content.split("\n")) {
          pendingCleanup.push(line);
        }
      }
      continue;
    }

    const examples = parseExamples(block.content);
    if (examples.length === 0) continue;

    if (isContinue && testOpen) {
      // Append to the open test function
      testBody.push(`  // --- continue (${fileName}:${block.line}) ---`);
      testBody.push(...emitExamples(examples, { filePath, blockLine: block.line }));
    } else {
      if (isContinue) {
        throw new Error(
          `${fileName}:${block.line}: 'continue' block has no open test to continue — ` +
            "it would silently become a new test. Make the first example block a plain ```ts block.",
        );
      }
      // Close previous test if open
      closeTest();

      const firstExample = examples[0];
      if (!firstExample) continue;
      const firstLabel = (firstExample.expression.split("\n")[0] ?? "").trim();
      const testName = `${fileName}:${block.line} — ${firstLabel}`;

      testHeader = [
        `// ${fileName}:${block.line}`,
        `test(${JSON.stringify(testName)}, async (t) => {`,
        "  const __prints = [];",
        "  const print = (s) => void __prints.push(String(s));",
      ];
      testOpen = true;

      // A cleanup block that preceded this test still tears it down.
      if (pendingCleanup.length > 0) {
        addTeardown(pendingCleanup);
        pendingCleanup = [];
      }

      testBody.push(...emitExamples(examples, { filePath, blockLine: block.line }));
    }
  }

  // Close final test
  closeTest();

  return out.join("\n");
}
