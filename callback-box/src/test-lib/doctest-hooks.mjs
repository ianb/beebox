/**
 * Node.js loader hooks for .doctest.md files.
 *
 * Transforms markdown files with code examples into tap test modules.
 * Registered via doctest-loader.ts using node:module register().
 *
 * Format:
 *   - ```ts setup blocks are inserted at module scope (imports, helpers)
 *   - ``` blocks contain one example each: expression => expected
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
 * Parse an example block into expression and expected value.
 *
 * Format:
 *   expression
 *   => expected (single line)
 *
 *   expression
 *   =>
 *   expected (multi-line, rest of block)
 *
 *   expression (no => means "just run, don't assert")
 */
export function parseExample(content) {
  const lines = content.split("\n");
  let arrowIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "=>" || lines[i].startsWith("=> ")) {
      arrowIndex = i;
      break;
    }
  }

  if (arrowIndex === -1) {
    // No expected value — just run the expression
    return { expression: content.trim(), expected: null };
  }

  const expression = lines
    .slice(0, arrowIndex)
    .join("\n")
    .trim()
    .replace(/;\s*$/, ""); // strip trailing semicolon

  const arrowLine = lines[arrowIndex];
  let expected;

  if (arrowLine === "=>") {
    // Multi-line: everything after => line
    expected = lines.slice(arrowIndex + 1).join("\n");
  } else {
    // Single-line: "=> value", possibly with more lines
    expected = arrowLine.slice(3); // "=> ".length === 3
    if (arrowIndex + 1 < lines.length) {
      expected += "\n" + lines.slice(arrowIndex + 1).join("\n");
    }
  }

  // Trim trailing whitespace but preserve internal structure
  expected = expected.replace(/\s+$/, "");

  return { expression, expected };
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
  out.push("");

  // Insert setup blocks at module scope
  for (const block of setupBlocks) {
    out.push(`// --- setup (${fileName}:${block.line}) ---`);
    out.push(block.content);
    out.push("");
  }

  // Generate test cases from example blocks
  for (const block of exampleBlocks) {
    const { expression, expected } = parseExample(block.content);
    if (!expression) continue;

    // Use first line of expression as test label
    const label = expression.split("\n")[0].trim();
    const testName = `${fileName}:${block.line} — ${label}`;

    out.push(`// ${fileName}:${block.line}`);

    if (expected !== null) {
      out.push(`test(${JSON.stringify(testName)}, async (t) => {`);
      out.push(`  await t.check(${expression}, ${JSON.stringify(expected)});`);
      out.push(`});`);
    } else {
      // No expected value — just run, check it doesn't throw
      out.push(`test(${JSON.stringify(testName)}, async (t) => {`);
      out.push(`  ${expression};`);
      out.push(`  t.pass("did not throw");`);
      out.push(`});`);
    }
    out.push("");
  }

  return out.join("\n");
}
