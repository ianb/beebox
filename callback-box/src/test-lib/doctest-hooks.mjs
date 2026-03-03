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
    const source = generateTestSource(markdown, filePath);
    return { format: "module", source, shortCircuit: true };
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
 * Generate a tap test module source from parsed markdown.
 */
export function generateTestSource(markdown, filePath) {
  const blocks = parseCodeBlocks(markdown);
  const setupBlocks = blocks.filter((b) => b.info.includes("setup"));
  const exampleBlocks = blocks.filter((b) => !b.info.includes("setup"));

  const fileName = basename(filePath);
  const out = [];

  out.push('import { test } from "tap";');
  // Trim trailing newlines from string results — doctest expected values
  // can't express trailing newlines since code blocks naturally trim them.
  out.push("function __trim(v) { return typeof v === 'string' ? v.replace(/\\n+$/, '') : v; }");
  out.push("");

  // Insert setup blocks at module scope
  for (const block of setupBlocks) {
    out.push(`// --- setup (${fileName}:${block.line}) ---`);
    out.push(block.content);
    out.push("");
  }

  // Generate test cases from example blocks
  for (const block of exampleBlocks) {
    const examples = parseExamples(block.content);

    for (const ex of examples) {
      if (!ex.expression) continue;

      const label = ex.expression.split("\n")[0].trim();
      const line = block.line + ex.lineOffset;
      const testName = `${fileName}:${line} — ${label}`;

      out.push(`// ${fileName}:${line}`);

      if (ex.expected !== null) {
        out.push(`test(${JSON.stringify(testName)}, async (t) => {`);
        out.push(`  await t.check(__trim(${ex.expression}), ${JSON.stringify(ex.expected)});`);
        out.push(`});`);
      } else {
        out.push(`test(${JSON.stringify(testName)}, async (t) => {`);
        out.push(`  ${ex.expression};`);
        out.push(`  t.pass("did not throw");`);
        out.push(`});`);
      }
      out.push("");
    }
  }

  return out.join("\n");
}
