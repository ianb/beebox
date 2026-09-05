/**
 * Parses `.doctest.md` fenced code blocks and their `expression => expected`
 * examples into structured data that doctest-generate.ts turns into a tap
 * test module.
 *
 * Split out of doctest-hooks.ts (the actual Node module-customization hook
 * Node imports) purely to keep that file to the loader hooks themselves;
 * this module has no Node loader responsibilities.
 */

// ── Code blocks ──────────────────────────────────────────────────────────────

/** One fenced code block extracted from a doctest markdown file. */
export interface CodeBlock {
  /** The fence's info string (e.g. `"ts setup"`), trimmed. */
  info: string;
  /** The block's body, between the fences. */
  content: string;
  /** 1-based line number of the first content line. */
  line: number;
}

/**
 * Parse fenced code blocks from markdown.
 */
export function parseCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const fenceMatch = (lines[i] ?? "").match(/^```(\S*(?:\s+\S+)*)?$/);
    if (fenceMatch) {
      const info = (fenceMatch[1] ?? "").trim();
      const blockStartLine = i + 1; // 0-based line of opening fence
      const contentLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").match(/^```\s*$/)) {
        contentLines.push(lines[i] ?? "");
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
 *
 * Exported for doctest-generate.ts, which needs the same lexer to avoid
 * indenting or splitting inside a template's string content.
 */
export function nextTemplateState(inTemplate: boolean, line: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] ?? "";
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

// ── Examples ─────────────────────────────────────────────────────────────────

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
export interface Example {
  expression: string;
  expected: string | null;
  /** 0-based offset of the expression within its block. */
  lineOffset: number;
  /** Original markdown example text, used in failure diagnostics. */
  source: string;
}

/** An example whose `=> throws ...` arrow asserts a thrown error. */
export interface ThrowsExample extends Example {
  expected: string;
  throws: true;
}

export function parseExamples(content: string): Array<Example | ThrowsExample> {
  const lines = content.split("\n");
  const examples: Array<Example | ThrowsExample> = [];
  let i = 0;

  while (i < lines.length) {
    // Skip blank lines between examples
    if ((lines[i] ?? "").trim() === "") {
      i++;
      continue;
    }

    // Collect expression lines (everything until => or end of content).
    // While inside a multi-line template literal, blank lines and
    // `=>`-looking lines are string content, not example boundaries.
    const exprStart = i;
    const exprLines: string[] = [];
    let inTemplate = false;
    while (
      i < lines.length &&
      (inTemplate ||
        ((lines[i] ?? "") !== "=>" &&
          !(lines[i] ?? "").startsWith("=> ") &&
          (lines[i] ?? "").trim() !== ""))
    ) {
      const line = lines[i] ?? "";
      inTemplate = nextTemplateState(inTemplate, line);
      exprLines.push(line);
      i++;
    }

    if (exprLines.length === 0) {
      i++;
      continue;
    }

    const expression = exprLines.join("\n").trim().replace(/;\s*$/, "");

    // Check for => arrow
    if (i < lines.length && ((lines[i] ?? "") === "=>" || (lines[i] ?? "").startsWith("=> "))) {
      const arrowLine = lines[i] ?? "";
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
        const expectedLines: string[] = [];
        if (arrowLine.startsWith("=> ")) {
          expectedLines.push(arrowLine.slice(3));
        }
        while (i < lines.length && (lines[i] ?? "").trim() !== "") {
          expectedLines.push(lines[i] ?? "");
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
export function parseExample(content: string): Example | ThrowsExample {
  const examples = parseExamples(content);
  return examples[0] ?? { expression: "", expected: null, lineOffset: 0, source: "" };
}
