/**
 * Node.js loader hooks for .doctest.md files.
 *
 * Transforms markdown files with code examples into tap test modules.
 * Registered via doctest-loader.ts using node:module register().
 *
 * Format:
 *   - ```ts setup blocks are inserted at module scope (imports, helpers)
 *   - ``` blocks contain examples: expression => expected (multiple per block OK)
 *   - check() is always available (via tap-check.ts --import)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { transformSync } from "esbuild";

// ── Loader hooks ────────────────────────────────────────────────────────────

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".doctest.md")) {
    const url = new URL(specifier, context.parentURL || "file:///").href;
    return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".doctest.md")) {
    const filePath = fileURLToPath(url);
    const markdown = readFileSync(filePath, "utf-8");
    const tsSource = generateTestSource(markdown, filePath);
    const { code } = transformSync(tsSource, {
      loader: "ts",
      format: "esm",
      sourcefile: filePath,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse fenced code blocks from markdown.
 * Returns array of { info, content, line } where line is 1-based.
 */
export function parseCodeBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^```(\S*(?:\s+\S+)*)?$/);
    if (fenceMatch) {
      const info = (fenceMatch[1] || "").trim();
      const blockStartLine = i + 1; // 0-based line of opening fence
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^```\s*$/)) {
        contentLines.push(lines[i]);
        i++;
      }
      blocks.push({
        info,
        content: contentLines.join("\n"),
        line: blockStartLine + 1, // 1-based line of first content line
      });
      i++; // skip closing ```
    } else {
      i++;
    }
  }

  return blocks;
}

/**
 * Parse one or more examples from a code block.
 *
 * Single-line result:
 *   expression
 *   => expected
 *
 * Multi-line result (=> alone, continues until blank line or end of block):
 *   expression
 *   =>
 *   line 1
 *   line 2
 *
 * Multiple examples in one block (separated by blank lines):
 *   foo("a")
 *   => 1
 *
 *   foo("b")
 *   => 2
 *
 * No => means "just run, check it doesn't throw".
 *
 * Returns array of { expression, expected, lineOffset } where lineOffset
 * is the 0-based offset of the expression within the block.
 */
export function parseExamples(content) {
  const lines = content.split("\n");
  const examples = [];
  let i = 0;

  while (i < lines.length) {
    // Skip blank lines between examples
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    // Collect expression lines (everything until => or end of content)
    const exprStart = i;
    const exprLines = [];
    while (i < lines.length && lines[i] !== "=>" && !lines[i].startsWith("=> ") && lines[i].trim() !== "") {
      exprLines.push(lines[i]);
      i++;
    }

    if (exprLines.length === 0) {
      i++;
      continue;
    }

    const expression = exprLines.join("\n").trim().replace(/;\s*$/, "");

    // Check for => arrow
    if (i < lines.length && (lines[i] === "=>" || lines[i].startsWith("=> "))) {
      const arrowLine = lines[i];
      i++;

      if (arrowLine.startsWith("=> ")) {
        // Single-line result: "=> value"
        examples.push({ expression, expected: arrowLine.slice(3), lineOffset: exprStart });
      } else {
        // Multi-line result: collect until blank line or end of block
        const expectedLines = [];
        while (i < lines.length && lines[i].trim() !== "") {
          expectedLines.push(lines[i]);
          i++;
        }
        examples.push({
          expression,
          expected: expectedLines.join("\n").replace(/\s+$/, ""),
          lineOffset: exprStart,
        });
      }
    } else {
      // No => — just run, no assertion
      examples.push({ expression, expected: null, lineOffset: exprStart });
    }
  }

  return examples;
}

// Backward compat — parse a single example (used by tests)
export function parseExample(content) {
  const examples = parseExamples(content);
  return examples[0] || { expression: "", expected: null };
}

// ── Generator ───────────────────────────────────────────────────────────────

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
function splitExpression(expression) {
  const lines = expression.split("\n");
  if (lines.length === 1) {
    return { setup: [], expr: expression };
  }

  // Find the last line ending with ;
  let lastSemi = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd().endsWith(";")) {
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
    const last = setup.pop();
    return { setup, expr: last.replace(/;\s*$/, "") };
  }

  return { setup, expr: exprPart };
}

/**
 * Emit examples into the output array (shared by normal and continue blocks).
 * @param {string} indent - indentation prefix (default "  ")
 */
function emitExamples(out, examples, indent = "  ") {
  for (const ex of examples) {
    if (!ex.expression) continue;

    if (ex.expected !== null) {
      const { setup, expr } = splitExpression(ex.expression);
      for (const line of setup) {
        out.push(`${indent}${line}`);
      }
      out.push(`${indent}await t.check(__withPrints(__prints, ${expr}), ${JSON.stringify(ex.expected)});`);
    } else {
      // No assertion — just run the statements
      for (const line of ex.expression.split("\n")) {
        out.push(`${indent}${line}`);
      }
    }
  }
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
export function generateTestSource(markdown, filePath) {
  const blocks = parseCodeBlocks(markdown);

  const fileName = basename(filePath);
  const out = [];

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
  let pendingCleanup = []; // cleanup lines waiting for a test to attach to

  function closeTest() {
    if (!testOpen) return;
    out.push(`});`);
    out.push("");
    testOpen = false;
  }

  for (const block of blocks) {
    if (block.info.includes("setup")) continue;

    const isContinue = block.info.includes("continue");
    const isCleanup = block.info.includes("cleanup");

    if (isCleanup) {
      if (testOpen) {
        // Emit teardown inline in the current test
        out.push(`  t.teardown(async () => {`);
        for (const line of block.content.split("\n")) {
          out.push(`    ${line}`);
        }
        out.push(`  });`);
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
      out.push(`  // --- continue (${fileName}:${block.line}) ---`);
      emitExamples(out, examples);
    } else {
      // Close previous test if open
      closeTest();

      const firstLabel = examples[0].expression.split("\n")[0].trim();
      const testName = `${fileName}:${block.line} — ${firstLabel}`;

      out.push(`// ${fileName}:${block.line}`);
      out.push(`test(${JSON.stringify(testName)}, async (t) => {`);
      out.push(`  const __prints = [];`);
      out.push(`  const print = (s) => void __prints.push(String(s));`);
      testOpen = true;

      // Emit any pending cleanup as teardown
      if (pendingCleanup.length > 0) {
        out.push(`  t.teardown(async () => {`);
        for (const line of pendingCleanup) {
          out.push(`    ${line}`);
        }
        out.push(`  });`);
        pendingCleanup = [];
      }

      emitExamples(out, examples);
    }
  }

  // Close final test
  closeTest();

  return out.join("\n");
}
