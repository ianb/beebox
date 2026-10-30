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
 * monorepo root. An unresolved plan or issue path whose file moved to another
 * lifecycle directory is a fixable `moved` finding: an
 * `issues/<cat>/<name>.md` whose `issues/closed/<cat>/<name>.md` exists, or a
 * plan or issue whose basename matches exactly one plan or issue file (the
 * unique-basename rule link-repair.ts uses, limited to those directories). Two
 * or more matches is an `ambiguous` finding, reported and never guessed.
 *
 * Code and YAML files (source comments, schedule configs,
 * `knowledge-audits.yaml`) name `.md` files bare as often as backticked;
 * `findMovedPathMentions` finds those mentions and reports only the moved and
 * ambiguous ones, since a missing path there may be a fixture or a proposal.
 *
 * Pure logic (fs injected as a callback) so it is unit-testable;
 * `check.ts` wires it to the real tree.
 */

import * as path from "node:path";

// A token must start with one of these repo directories (repo root or package
// root) and end in a file extension. bin/skill-lint.ts shares the list.
export const REPO_PATH_DIRS = [
  "beebox", "bin", "docs", "src", "test", "schedules", "workstreams-app", "ios-app", "canvas-loop", "issues",
  ".claude", "tap-check", "deploy", "scan-uploader", "beebox-clerk", "personal-vibe-check", "research", "dev",
];
const CANDIDATE_RE = /^[^\s/]+\/\S*\.[A-Za-z]{1,5}$/;
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

export type FilePathProblemKind = "missing" | "moved" | "ambiguous";

export interface FilePathProblem {
  line: number;
  token: string; // the text as written (including any :line suffix)
  kind: FilePathProblemKind;
  suggestion?: string; // replacement token for moved
  candidates?: string[]; // repo-relative matches for ambiguous
  tried: string[]; // repo-relative paths the token was resolved against
}

// basename -> repo-relative paths (link-repair.ts `buildBasenameLookup`).
export type BasenameLookup = ReadonlyMap<string, readonly string[]>;

// The repo-relative path the token names, or undefined when it is not a
// candidate. Exported for tests.
export function candidatePath(token: string, docRel: string): string | undefined {
  if (PLACEHOLDER_RE.test(token)) return undefined;
  const file = token.replace(LINE_SUFFIX_RE, "");
  if (!CANDIDATE_RE.test(file) || !REPO_PATH_DIRS.includes(file.split("/")[0] ?? "")) return undefined;
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

// Write `newPath` (repo-relative) in the same style as the token's `file`: the
// first resolution base that contains `newPath` and under which the new path
// starts with the token's first segment. A root-relative path otherwise.
function rewrittenFile({ file, newPath, docRel }: { file: string; newPath: string; docRel: string }): string {
  const first = file.split("/")[0];
  for (const base of [path.posix.dirname(docRel), docRel.split("/")[0] ?? ".", MAIN_PACKAGE]) {
    if (!newPath.startsWith(`${base}/`)) continue;
    const rel = newPath.slice(base.length + 1);
    if (rel.split("/")[0] === first) return rel;
  }
  return newPath;
}

type Relocation = { kind: "moved"; newPath: string } | { kind: "ambiguous"; candidates: string[] } | { kind: "missing" };

// Plans and issues move between lifecycle directories (plans/ to
// implemented-plans/, bugs/ to closed/bugs/) and keep their basename. Only
// those moves are relocated: a generic basename (`summary.md`, `index.md`)
// elsewhere in the tree is too often a different file.
const LIFECYCLE_RE = /^(?:beebox\/docs\/(?:plans|implemented-plans|unimplemented-plans)|issues)\//;
// The same directories as a token names them: monorepo- or package-relative.
const LIFECYCLE_TOKEN_RE = /^(?:(?:beebox\/)?docs\/(?:plans|implemented-plans|unimplemented-plans)|issues)\//;

// Where an unresolved plan or issue path lives now: its closed/ copy, else
// the one plan or issue file with its basename.
function relocate({ file, fileExists, basenameLookup }: {
  file: string; fileExists: (repoRel: string) => boolean; basenameLookup: BasenameLookup | undefined;
}): Relocation {
  const issue = OPEN_ISSUE_RE.exec(file);
  const closed = issue ? `issues/closed/${issue[1]}/${issue[2]}` : undefined;
  if (closed !== undefined && fileExists(closed)) return { kind: "moved", newPath: closed };
  if (!file.endsWith(".md") || basenameLookup === undefined || !LIFECYCLE_TOKEN_RE.test(file)) return { kind: "missing" };
  const candidates = (basenameLookup.get(path.posix.basename(file)) ?? []).filter((c) => LIFECYCLE_RE.test(c));
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) return { kind: "moved", newPath: only };
  if (candidates.length >= 2) return { kind: "ambiguous", candidates };
  return { kind: "missing" };
}

function problemFor(params: {
  text: string; file: string; line: number; docRel: string;
  fileExists: (repoRel: string) => boolean; basenameLookup: BasenameLookup | undefined;
}): FilePathProblem | undefined {
  const { text, file, line, docRel, fileExists, basenameLookup } = params;
  const tried = resolutionCandidates(file, docRel);
  if (tried.some(fileExists)) return undefined;
  const found = relocate({ file, fileExists, basenameLookup });
  if (found.kind === "moved") {
    return { line, token: text, kind: "moved", suggestion: text.replace(file, rewrittenFile({ file, newPath: found.newPath, docRel })), tried };
  }
  if (found.kind === "ambiguous") return { line, token: text, kind: "ambiguous", candidates: found.candidates, tried };
  return { line, token: text, kind: "missing", tried };
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

// Backticked repo paths in a Markdown doc. `basenameLookup` (tracked `.md`
// files) enables the unique-basename relocation; without it only the closed/
// relocation applies.
export function findFilePathProblems({
  docRel,
  content,
  fileExists,
  basenameLookup,
}: {
  docRel: string;
  content: string;
  fileExists: (repoRel: string) => boolean;
  basenameLookup?: BasenameLookup;
}): FilePathProblem[] {
  const problems: FilePathProblem[] = [];
  for (const block of inlineBlocks(content.split("\n"))) {
    for (const { text, line } of singleBacktickSpans(block.text)) {
      const file = candidatePath(text, docRel);
      if (file === undefined) continue;
      const problem = problemFor({ text, file, line: block.start + line + 1, docRel, fileExists, basenameLookup });
      if (problem) problems.push(problem);
    }
  }
  return problems;
}

// A bare or backticked `.md` path in code or YAML: starts with a repo
// directory, is not preceded by a path character (so `../docs/x.md` and URLs
// do not match), and may carry a `:line` suffix.
const MENTION_RE = /(?<![\w./:@-])((?:[\w-]+|\.claude)\/[\w./-]*\.md(?::L?\d+(?:-L?\d+)?)?)(?![\w/-])/g;

// `.md` path mentions in a code or YAML file whose target moved (fixable) or
// matches 2+ files by basename (reported). Missing paths are not reported.
export function findMovedPathMentions({
  docRel,
  content,
  fileExists,
  basenameLookup,
}: {
  docRel: string;
  content: string;
  fileExists: (repoRel: string) => boolean;
  basenameLookup: BasenameLookup;
}): FilePathProblem[] {
  const problems: FilePathProblem[] = [];
  for (const [i, line] of content.split("\n").entries()) {
    for (const m of line.matchAll(MENTION_RE)) {
      const text = m[1] ?? "";
      const file = candidatePath(text, docRel);
      if (file === undefined) continue;
      const problem = problemFor({ text, file, line: i + 1, docRel, fileExists, basenameLookup });
      if (problem && problem.kind !== "missing") problems.push(problem);
    }
  }
  return problems;
}

// Path tokens in one file that name `target` (repo-relative) — backticked
// spans in Markdown, or bare and backticked `.md` mentions in code and YAML
// (`bare`) — as `moved` findings whose suggestion names `newPath`. A token
// names `target` when `target` is its only resolution candidate that exists;
// when another candidate exists too, the token is an `ambiguous` finding and
// is never rewritten. Used by a targeted move (bin/lib/doc-move.ts), which knows the
// file and so never guesses by basename.
export function findMentionsOf({ docRel, content, target, newPath, bare, fileExists }: {
  docRel: string;
  content: string;
  target: string;
  newPath: string;
  bare: boolean;
  fileExists: (repoRel: string) => boolean;
}): FilePathProblem[] {
  const tokens: Array<{ text: string; line: number }> = [];
  if (bare) {
    for (const [i, line] of content.split("\n").entries()) {
      for (const m of line.matchAll(MENTION_RE)) tokens.push({ text: m[1] ?? "", line: i + 1 });
    }
  } else {
    for (const block of inlineBlocks(content.split("\n"))) {
      for (const span of singleBacktickSpans(block.text)) tokens.push({ text: span.text, line: block.start + span.line + 1 });
    }
  }
  const problems: FilePathProblem[] = [];
  for (const { text, line } of tokens) {
    const file = candidatePath(text, docRel);
    if (file === undefined) continue;
    const tried = resolutionCandidates(file, docRel);
    const existing = tried.filter(fileExists);
    if (!existing.includes(target)) continue;
    if (existing.length > 1) {
      problems.push({ line, token: text, kind: "ambiguous", candidates: existing, tried });
      continue;
    }
    problems.push({ line, token: text, kind: "moved", suggestion: text.replace(file, rewrittenFile({ file, newPath, docRel })), tried });
  }
  return problems;
}

// Characters that continue a path on either side of a bare token.
const PATH_CHAR_BEFORE = /[\w./:@-]/;
const PATH_CHAR_AFTER = /[\w/-]/;

// Replace each occurrence of `token` in `line` that is not part of a longer
// path.
function replaceBareToken({ line, token, replacement }: { line: string; token: string; replacement: string }): string {
  let out = "";
  let cursor = 0;
  for (let at = line.indexOf(token); at !== -1; at = line.indexOf(token, at + token.length)) {
    const before = line[at - 1] ?? "";
    const after = line[at + token.length] ?? "";
    if (PATH_CHAR_BEFORE.test(before) || PATH_CHAR_AFTER.test(after)) continue;
    out += line.slice(cursor, at) + replacement;
    cursor = at + token.length;
  }
  return out + line.slice(cursor);
}

// Rewrite every moved token in `content` to its suggestion. Other problems
// are left for a human. `bare` also rewrites un-backticked mentions (code and
// YAML sources), bounded so a token never matches inside a longer path.
export function repairFilePaths({ content, problems, bare }: { content: string; problems: FilePathProblem[]; bare?: boolean }): string {
  const byLine = new Map<number, FilePathProblem[]>();
  for (const p of problems) {
    if (p.kind !== "moved") continue;
    byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
  }
  return content
    .split("\n")
    .map((line, i) => {
      let out = line;
      for (const p of byLine.get(i + 1) ?? []) {
        const { suggestion } = p;
        if (suggestion === undefined) continue;
        out = bare === true
          ? replaceBareToken({ line: out, token: p.token, replacement: suggestion })
          : out.replaceAll(`\`${p.token}\``, `\`${suggestion}\``);
      }
      return out;
    })
    .join("\n");
}

export function describeFilePathProblem(docRel: string, p: FilePathProblem): string {
  if (p.kind === "moved") return `moved file path: ${docRel}:${p.line} \`${p.token}\` -> \`${p.suggestion ?? ""}\` (pnpm doc-check --fix rewrites it)`;
  if (p.kind === "ambiguous") return `ambiguous file path: ${docRel}:${p.line} \`${p.token}\` matches ${(p.candidates ?? []).join(", ")}`;
  return `missing file path: ${docRel}:${p.line} \`${p.token}\``;
}
