/**
 * Include lines in agent instruction files.
 *
 * An `AGENTS.md` or `CLAUDE.md` pulls another file into the agent's context
 * with a line that holds only `@<path>`, relative to the including file's
 * folder (`core/docs-gen/generate/agents-md.ts` writes them). Read as
 * Markdown, adjacent include lines join into one paragraph and the `_` in
 * `_content/` can start emphasis. The renderer swaps each line for a
 * render-only `{% include-file %}` tag before parsing.
 */

const INSTRUCTION_FILE = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/;

// The path excludes quotes and Markdoc tag delimiters so it can sit in a tag
// attribute unescaped; a line with any of them stays plain text.
const INCLUDE_LINE = /^@([^\s"%'\\{}]+)\s*$/;

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** A closing fence: up to three spaces, then at least the opening run of the same character, then nothing. */
function closesFence(line: string, open: string): boolean {
  const close = /^ {0,3}(`+|~+)\s*$/.exec(line)?.[1];
  return close !== undefined && close[0] === open[0] && close.length >= open.length;
}

/** Whether `path` names an agent instruction file, whose include lines render as includes. */
export function isInstructionFile(path: string | undefined): boolean {
  return path !== undefined && INSTRUCTION_FILE.test(path);
}

/**
 * Replace each include line outside fenced code with an `include-file` tag.
 * Every line maps to one line, so source line numbers do not shift.
 */
export function rewriteIncludeLines(source: string): string {
  let fence: string | null = null;
  return source.split("\n").map((line) => {
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      return line;
    }
    const open = FENCE_OPEN.exec(line);
    if (open?.[1] !== undefined) {
      fence = open[1];
      return line;
    }
    const include = INCLUDE_LINE.exec(line);
    if (include?.[1] === undefined) return line;
    return `{% include-file path="${include[1]}" /%}`;
  }).join("\n");
}
