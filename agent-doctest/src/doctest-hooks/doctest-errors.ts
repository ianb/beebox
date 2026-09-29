/**
 * The one error a doctest author sees when a `.doctest.md` cannot become a
 * test module: a parse error, an unknown directive, an orphan `continue`.
 *
 * Everything is in `message`, because the error is thrown in Node's loader
 * thread and only the message reliably crosses back to the main thread. The
 * message names the markdown line, shows it, shows the first lines of the
 * block it is in (a line number alone goes stale while the author edits),
 * and gives a fix when the cause is recognisable.
 */

export class DoctestSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoctestSyntaxError";
  }
}

/** A block's position, for naming it in a message. */
export interface BlockSpan {
  /** 1-based line of the opening fence. */
  fence: number;
  /** 1-based first and last content lines. */
  start: number;
  end: number;
  info: string;
}

export interface SyntaxErrorReport {
  fileName: string;
  markdown: string;
  /** 1-based markdown line the problem is on. */
  line: number;
  /** What went wrong, in one line. */
  problem: string;
  blocks: BlockSpan[];
  hints?: string[];
}

function excerpt(lines: string[], { from, count }: { from: number; count: number }): string[] {
  const out: string[] = [];
  const width = String(from + count).length;
  for (let n = from; n < from + count && n <= lines.length; n++) {
    out.push(`    ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
  }
  return out;
}

/** The block (fence line through closing fence) that contains a line. */
export function blockAt(blocks: BlockSpan[], line: number): BlockSpan | null {
  return blocks.find((b) => line >= b.fence && line <= b.end + 1) ?? null;
}

export function formatSyntaxError(report: SyntaxErrorReport): string {
  const lines = report.markdown.split("\n");
  const out = [`${report.fileName}:${report.line}: ${report.problem}`];
  out.push(...excerpt(lines, { from: report.line, count: 1 }));
  const block = blockAt(report.blocks, report.line);
  if (block && block.start < report.line) {
    out.push(`  in the \`\`\`${block.info} block at ${report.fileName}:${block.fence}:`);
    out.push(...excerpt(lines, { from: block.start, count: Math.min(2, report.line - block.start) }));
  }
  for (const hint of report.hints ?? []) out.push(`  hint: ${hint}`);
  return out.join("\n");
}

// ── Recognising common causes of a parse error ───────────────────────────────

/** Words and spaces, no code punctuation: a sentence someone meant as prose. */
function looksLikeProse(text: string): boolean {
  const t = text.trim();
  if (!/^[A-Z][a-z]*[\s,]/.test(t)) return false;
  if (/[();=[\]{}]|=>/.test(t)) return false;
  return t.split(/\s+/).length >= 3;
}

/**
 * Hints for an esbuild parse error on a markdown line. `prevExpectedGap` is
 * true when the line follows a blank line that ended an expected value.
 */
export function parseErrorHints(opts: { problem: string; text: string; prevExpectedGap: boolean }): string[] {
  const hints: string[] = [];
  const prose = looksLikeProse(opts.text);
  if (prose) {
    hints.push(
      "this line looks like prose inside a code fence. Close the fence before it, " +
        "write the prose, and reopen with ```ts continue after it." +
        (opts.prevExpectedGap
          ? " If it is instead more of the output above, a blank line ended that expected value: write «blankline» for the blank line."
          : ""),
    );
  } else if (opts.prevExpectedGap) {
    hints.push(
      "a blank line ends an expected value, so this line was read as code. " +
        "If the output really contains a blank line, write «blankline» there.",
    );
  }
  const declaration = /^\s*(?:const|let|var)\s+(\w+)/.exec(opts.text);
  if (declaration && /^Unexpected "(?:const|let|var)"/.test(opts.problem)) {
    hints.push(
      `a declaration has no value for => to check. Put ${declaration[1] ?? "the name"} on its own line after it.`,
    );
  }
  if (/has already been declared/.test(opts.problem)) {
    hints.push(
      "a ```ts continue block shares one scope with the block it continues, and setup " +
        "declarations are visible everywhere. Use a different name, or declare it with let and reassign.",
    );
  }
  return hints;
}
