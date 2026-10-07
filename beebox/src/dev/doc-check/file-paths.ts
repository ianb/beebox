/**
 * Backticked repo-path check: prose like `beebox/src/foo/bar.ts` names a file,
 * and those names decay when files move (issues resolving into
 * `issues/closed/`, renamed modules, relocated frontend files). This finds
 * single-backtick spans that look like anchored repo paths and reports the
 * ones that resolve nowhere.
 *
 * A token is a candidate only when it starts with a known repo directory and
 * ends in a file extension, so box-relative paths (`.beebox/`, `content/`),
 * URL routes, and directory mentions never match. Placeholders (`<x>`, `*`,
 * `{a,b}`, `...`) are skipped; a trailing `:line` or `:start-end` suffix is
 * stripped before resolution. A token resolves if it exists relative to the
 * doc's directory, the doc's package root, the beebox package, or the
 * monorepo root. An unresolved `issues/<cat>/<name>.md` whose
 * `issues/closed/<cat>/<name>.md` exists is a fixable moved-to-closed finding.
 *
 * Pure logic (fs injected as a callback) so it is unit-testable;
 * `check.ts` wires it to the real tree.
 */

import * as path from "node:path";

// A token must start with one of these repo directories (repo root or package
// root) and end in a file extension.
const CANDIDATE_RE =
  /^(?:beebox|bin|docs|src|test|schedules|workstreams-app|ios-app|canvas-loop|issues|\.claude|agent-doctest|deploy|scan-uploader|beebox-clerk|personal-vibe-check|research|dev)\/\S*\.[A-Za-z]{1,5}$/;
const PLACEHOLDER_RE = /[*<>{}…]|\.{3}/;
const LINE_SUFFIX_RE = /:L?\d+(?:-L?\d+)?$/;
// `issues/<category>/<name>.md` (not already under closed/).
const OPEN_ISSUE_RE = /^issues\/(?!closed\/)([^/]+)\/([^/]+\.md)$/;

// Box-facing docs (the docs/box/ sources and the box-docs/ build output) are
// read by box agents inside a box: their `src/`, `.claude/rules/`, and
// `.claude/skills/` paths name the box's own tree, never the repo's.
const BOX_FACING_PREFIXES = ["beebox/docs/box/", "beebox/box-docs/"];

// beebox is the main package; repo-root docs (skills, schedules, issues)
// conventionally name its files package-relative (`src/core/x.ts`).
const MAIN_PACKAGE = "beebox";

export type FilePathProblemKind = "missing" | "moved-to-closed";

export interface FilePathProblem {
  line: number;
  token: string; // the backticked text as written (including any :line suffix)
  kind: FilePathProblemKind;
  suggestion?: string; // replacement token for moved-to-closed
  tried: string[]; // repo-relative paths the token was resolved against
}

// The repo-relative path the token names, or undefined when it is not a
// candidate. Exported for tests.
export function candidatePath(token: string, docRel: string): string | undefined {
  if (PLACEHOLDER_RE.test(token)) return undefined;
  const file = token.replace(LINE_SUFFIX_RE, "");
  if (!CANDIDATE_RE.test(file)) return undefined;
  if (BOX_FACING_PREFIXES.some((p) => docRel.startsWith(p))) return undefined;
  return file;
}

// Repo-relative paths a token may name: relative to the doc's own directory,
// the doc's package root (first path segment), the main package, and the
// monorepo root.
function resolutionCandidates(file: string, docRel: string): string[] {
  const bases = [path.posix.dirname(docRel), docRel.split("/")[0] ?? ".", MAIN_PACKAGE, "."];
  const joined = bases.map((base) => path.posix.normalize(path.posix.join(base, file)));
  return [...new Set(joined)].filter((p) => !p.startsWith(".."));
}

// A line that starts a new inline block: a blank line, heading, table row,
// or list item. A code span never crosses one.
const BLOCK_START_RE = /^\s*(?:$|#|\||[*+-]\s|\d+[).]\s)/;
const FENCE_RE = /^\s*(?:`{3,}|~{3,})/;

// Runs of consecutive lines inside which a code span may wrap, outside fenced
// code blocks. `start` is the 0-based index of the run's first line.
function inlineBlocks(lines: string[]): Array<{ start: number; text: string }> {
  const blocks: Array<{ start: number; lines: string[] }> = [];
  let inFence = false;
  for (const [i, line] of lines.entries()) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      blocks.push({ start: i + 1, lines: [] });
      continue;
    }
    const current = blocks.at(-1);
    if (inFence) continue;
    if (current === undefined || BLOCK_START_RE.test(line)) blocks.push({ start: i, lines: [line] });
    else current.lines.push(line);
  }
  return blocks.filter((b) => b.lines.length > 0).map((b) => ({ start: b.start, text: b.lines.join("\n") }));
}

// Single-backtick code spans in one block, with the 0-based line (relative to
// the block) where each span's text starts. Multi-backtick spans quote code
// that may itself contain backticks; they are skipped.
function singleBacktickSpans(text: string): Array<{ text: string; line: number }> {
  const spans: Array<{ text: string; line: number }> = [];
  for (const m of text.matchAll(/(`+)((?:(?!\1)[\S\s])*?)\1/g)) {
    const body = m[2];
    if (m[1] !== "`" || body === undefined) continue;
    const leading = body.length - body.trimStart().length;
    const offset = m.index + 1 + leading;
    spans.push({ text: body.trim(), line: text.slice(0, offset).split("\n").length - 1 });
  }
  return spans;
}

export function findFilePathProblems({
  docRel,
  content,
  fileExists,
}: {
  docRel: string;
  content: string;
  fileExists: (repoRel: string) => boolean;
}): FilePathProblem[] {
  const problems: FilePathProblem[] = [];
  for (const block of inlineBlocks(content.split("\n"))) {
    for (const { text, line } of singleBacktickSpans(block.text)) {
      const file = candidatePath(text, docRel);
      if (file === undefined) continue;
      const tried = resolutionCandidates(file, docRel);
      if (tried.some(fileExists)) continue;
      const issue = OPEN_ISSUE_RE.exec(file);
      const closed = issue ? `issues/closed/${issue[1]}/${issue[2]}` : undefined;
      const lineNum = block.start + line + 1;
      if (closed !== undefined && fileExists(closed)) {
        problems.push({ line: lineNum, token: text, kind: "moved-to-closed", suggestion: text.replace(file, closed), tried });
      } else {
        problems.push({ line: lineNum, token: text, kind: "missing", tried });
      }
    }
  }
  return problems;
}

// Rewrite every moved-to-closed token in `content` to its suggestion. Other
// problems are left for a human.
export function repairFilePaths(content: string, problems: FilePathProblem[]): string {
  const byLine = new Map<number, FilePathProblem[]>();
  for (const p of problems) {
    if (p.kind !== "moved-to-closed") continue;
    byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
  }
  return content
    .split("\n")
    .map((line, i) => {
      let out = line;
      for (const p of byLine.get(i + 1) ?? []) {
        if (p.suggestion !== undefined) out = out.replaceAll(`\`${p.token}\``, `\`${p.suggestion}\``);
      }
      return out;
    })
    .join("\n");
}

export function describeFilePathProblem(docRel: string, p: FilePathProblem): string {
  return p.kind === "moved-to-closed"
    ? `moved to closed: ${docRel}:${p.line} \`${p.token}\` -> \`${p.suggestion ?? ""}\` (pnpm doc-check --fix rewrites it)`
    : `missing file path: ${docRel}:${p.line} \`${p.token}\``;
}
