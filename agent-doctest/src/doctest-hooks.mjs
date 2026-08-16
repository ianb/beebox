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
import { tsxOnlyFallback } from "./resolve-rules.mjs";

// ── Loader hooks ────────────────────────────────────────────────────────────

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".doctest.md")) {
    const url = new URL(specifier, context.parentURL || "file:///").href;
    return { url, shortCircuit: true };
  }

  // The unambiguous TSX-only case, resolved here rather than depending on
  // tsx's downstream extension-probe sequence (which has intermittently
  // stopped at the missing .ts candidate under heavy parallel startup).
  // The rule itself lives in resolve-rules.mjs so that a static consumer of
  // the same import graph cannot disagree with the runner about it.
  const tsxUrl = tsxOnlyFallback(specifier, context.parentURL);
  if (tsxUrl !== null) return { url: tsxUrl, shortCircuit: true };

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
 * Track whether a multi-line template literal is open across one line of
 * example code. Scans the line with a small lexer: backticks inside
 * single/double-quoted strings or after a `//` line comment don't count,
 * and escapes (\`) are honored both inside and outside templates. Inside
 * template content everything except the closing backtick is ignored.
 *
 * Known approximations (kept deliberately — doctest examples are short):
 * backticks inside regex literals or inside `${}` interpolations aren't
 * understood. The failure mode of NOT tracking templates at all — silently
 * corrupting multi-line string content — is far worse than these edges.
 */
function nextTemplateState(inTemplate, line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      i++; // skip the escaped character
      continue;
    }
    if (inTemplate) {
      if (c === "`") inTemplate = false;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") inSingle = true;
    else if (c === '"') inDouble = true;
    else if (c === "/" && line[i + 1] === "/") break;
    else if (c === "`") inTemplate = true;
  }
  return inTemplate;
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
 * Returns array of { expression, expected, lineOffset, source } where
 * lineOffset is the 0-based offset of the expression within the block and
 * source is the original markdown example text used in failure diagnostics.
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

    // Collect expression lines (everything until => or end of content).
    // While inside a multi-line template literal, blank lines and
    // `=>`-looking lines are string content, not example boundaries.
    const exprStart = i;
    const exprLines = [];
    let inTemplate = false;
    while (
      i < lines.length &&
      (inTemplate ||
        (lines[i] !== "=>" && !lines[i].startsWith("=> ") && lines[i].trim() !== ""))
    ) {
      inTemplate = nextTemplateState(inTemplate, lines[i]);
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

      // Check for "=> throws ErrorName" or "=> throws ErrorName: message"
      if (arrowLine.startsWith("=> throws ")) {
        const throwsExpected = arrowLine.slice("=> throws ".length).trim();
        examples.push({
          expression,
          expected: throwsExpected,
          throws: true,
          lineOffset: exprStart,
          source: lines.slice(exprStart, i).join("\n"),
        });
      } else {
        // Collect expected lines until blank line or end of block.
        // If "=> value", the first line of expected is on the arrow line itself.
        // If "=>" alone, expected starts on the next line.
        const expectedLines = [];
        if (arrowLine.startsWith("=> ")) {
          expectedLines.push(arrowLine.slice(3));
        }
        while (i < lines.length && lines[i].trim() !== "") {
          expectedLines.push(lines[i]);
          i++;
        }
        examples.push({
          expression,
          expected: expectedLines.join("\n").replace(/\s+$/, ""),
          lineOffset: exprStart,
          source: lines.slice(exprStart, i).join("\n"),
        });
      }
    } else {
      // No => — just run, no assertion
      examples.push({
        expression,
        expected: null,
        lineOffset: exprStart,
        source: lines.slice(exprStart, i).join("\n"),
      });
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

  // Find the last line ending with ; — but a `;` at the end of a line
  // that's still inside a template literal is string content, not a
  // statement boundary.
  let lastSemi = -1;
  let inTemplate = false;
  for (let i = 0; i < lines.length; i++) {
    inTemplate = nextTemplateState(inTemplate, lines[i]);
    if (!inTemplate && lines[i].trimEnd().endsWith(";")) {
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
 * Push source lines with a cosmetic indent — except lines that begin
 * inside a multi-line template literal, which must be emitted verbatim:
 * an injected indent there silently changes the string's content.
 * @param {string[]|string} lines
 */
function emitLines(out, lines, indent) {
  const list = Array.isArray(lines) ? lines : lines.split("\n");
  let inTemplate = false;
  for (const line of list) {
    out.push(inTemplate ? line : `${indent}${line}`);
    inTemplate = nextTemplateState(inTemplate, line);
  }
}

/**
 * Emit examples into the output array (shared by normal and continue blocks).
 * @param {string} indent - indentation prefix (default "  ")
 */
function emitExamples(out, examples, filePath, blockLine, indent = "  ") {
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

    if (ex.throws) {
      const { setup, expr } = splitExpression(ex.expression);
      emitLines(out, setup, indent);
      const mode = ex.expected.includes(":") ? "full" : "name";
      // Async arrow + await so `=> throws` works on await-containing
      // expressions (rejections and sync throws both land in checkThrows).
      out.push(`${indent}await t.checkThrows(async () => (${expr}), { expected: ${JSON.stringify(ex.expected)}, mode: ${JSON.stringify(mode)}, diagnostic: ${diagnostic} });`);
    } else if (ex.expected !== null) {
      const { setup, expr } = splitExpression(ex.expression);
      emitLines(out, setup, indent);
      out.push(`${indent}await t.check(__withPrints(__prints, ${expr}), { check: ${JSON.stringify(ex.expected)}, diagnostic: ${diagnostic} });`);
    } else {
      // No assertion — just run the statements
      emitLines(out, ex.expression, indent);
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
  let testHeader = [];
  let testBody = [];
  let testTeardowns = [];

  /** Register one cleanup block as a teardown of the open test. */
  function addTeardown(lines) {
    testTeardowns.push(lines);
  }

  function closeTest() {
    if (!testOpen) return;
    out.push(...testHeader);
    for (const lines of testTeardowns) {
      out.push(`  t.teardown(async () => {`);
      out.push(`    try {`);
      emitLines(out, lines, "      ");
      // tap runs teardowns LIFO and abandons the rest once one throws, so one
      // cleanup that cannot run would skip every earlier cleanup and leak
      // exactly the handles they exist to release. That is reachable now that
      // registration is hoisted: a cleanup whose `continue` block never ran
      // references a `const` still in its temporal dead zone. Report the
      // failure as an assertion instead — visible, and it strands nothing.
      out.push(`    } catch (__cleanupError) {`);
      // console.error names it (tap has usually closed the test's plan by
      // teardown time, so its own diagnostic degrades to a generic "assertion
      // after Promise resolution"); t.error is what still turns it into a
      // non-zero exit.
      out.push(`      console.error("doctest cleanup block failed:", __cleanupError);`);
      out.push(`      t.error(__cleanupError, "doctest cleanup block failed");`);
      out.push(`    }`);
      out.push(`  });`);
    }
    out.push(...testBody);
    out.push(`});`);
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
        addTeardown(block.content);
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
      emitExamples(testBody, examples, filePath, block.line);
    } else {
      if (isContinue) {
        throw new Error(
          `${fileName}:${block.line}: 'continue' block has no open test to continue — ` +
            `it would silently become a new test. Make the first example block a plain \`\`\`ts block.`,
        );
      }
      // Close previous test if open
      closeTest();

      const firstLabel = examples[0].expression.split("\n")[0].trim();
      const testName = `${fileName}:${block.line} — ${firstLabel}`;

      testHeader = [
        `// ${fileName}:${block.line}`,
        `test(${JSON.stringify(testName)}, async (t) => {`,
        `  const __prints = [];`,
        `  const print = (s) => void __prints.push(String(s));`,
      ];
      testOpen = true;

      // A cleanup block that preceded this test still tears it down.
      if (pendingCleanup.length > 0) {
        addTeardown(pendingCleanup);
        pendingCleanup = [];
      }

      emitExamples(testBody, examples, filePath, block.line);
    }
  }

  // Close final test
  closeTest();

  return out.join("\n");
}
