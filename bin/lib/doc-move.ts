/**
 * Move one Markdown doc and rewrite every reference to it — the shared
 * operation behind closing an issue (`bin/issues close`), confirming a manual
 * test (`bin/workstreams confirm-tested`), and landing a plan (`bin/doc-move`).
 *
 * `doc-check --fix` repairs any broken link anywhere by unique basename, a
 * guess run over the whole working tree. A move knows exactly which file
 * moved, so it rewrites only references that resolve to that file's old path:
 * Markdown links and frontmatter paths, backticked repo paths in Markdown, and
 * `.md` mentions in code and YAML, test files included, then any remaining
 * path token that resolves only to the old path: a link label, a prose path,
 * an HTML href. The moved file's own relative links are re-expressed from its
 * new directory. Which files are read for which kind of reference follows
 * doc-check (beebox/src/dev/doc-check/scan-scope.ts).
 *
 * A reference it cannot rewrite safely (a token two files could answer to, a
 * public file linking into private-issues/) is a blocking notice: the move
 * refuses before it writes anything. An own link to a missing file is
 * reported and does not block; path arithmetic keeps it naming the same file.
 *
 * The move never stages. A worktree's index is shared by parallel workers
 * (root AGENTS.md), and a staged rename in the main checkout blocks bin/land,
 * so the move renames on disk and returns, per repository, the paths to
 * `git add`.
 *
 * `private-issues/` is a separate repository mounted at the monorepo root. A
 * move never crosses repositories. A private move reads only private files;
 * a public move also reads private Markdown, since a private file may link to
 * a public one (never the reverse).
 *
 * `planDocMove` is pure (reads injected); `moveDoc` adds the rename and writes.
 * Every refusal happens before anything is written.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { relocateLinks, type LinkRewrite } from "../../beebox/src/dev/doc-check/link-repair.js";
import { findMentionsOf, repairFilePaths } from "../../beebox/src/dev/doc-check/file-paths.js";
import { findPrivateLinkViolations } from "../../beebox/src/dev/doc-check/private-link.js";
import { AGENT_DOCS_PREFIX, isFilePathExempt, isLinkScanned } from "../../beebox/src/dev/doc-check/scan-scope.js";

import {
  CrossRepositoryError, DestinationExistsError, DirtyFilesError, MissingSourceError, NotMarkdownError,
  OutsideRepositoryError, SamePathError, UnsafeReferencesError, UntrackedSourceError, noticeLine,
} from "./doc-move-errors.js";

const PRIVATE_PREFIX = "private-issues/";

export type Repository = "public" | "private";

export interface DocMoveRewrite extends LinkRewrite {
  /** `label`: link text naming the old path; `prose`: any other path token. */
  kind: "link" | "path" | "label" | "prose";
}

export interface FileRewrite {
  path: string;
  repository: Repository;
  rewrites: DocMoveRewrite[];
  content: string;
}

/** Something the move could not settle; the person running it checks by hand. */
export interface DocMoveNotice {
  path: string;
  line: number | null;
  message: string;
  /** A reference the move cannot rewrite safely; the move refuses. */
  blocking: boolean;
}

export interface DocMovePlan {
  from: string;
  to: string;
  /** The moved file's new content and its own re-expressed links. */
  moved: FileRewrite;
  /** Other files with references to the moved file. */
  files: FileRewrite[];
  notices: DocMoveNotice[];
}

/** Paths to `git add -A --`, by repository, in that repository's own terms. */
export type StagePaths = Record<Repository, string[]>;

export interface DocMoveResult extends DocMovePlan {
  stage: StagePaths;
  /** Repo-relative files in the move that already had uncommitted changes. */
  dirtyBefore: string[];
}

function repositoryOf(rel: string): Repository {
  return rel.startsWith(PRIVATE_PREFIX) ? "private" : "public";
}

/** The edit a caller applies to the moved file after its links are re-expressed. */
export type EditMoved = (content: string) => string;

export function planDocMove({ from, to, sources, read, exists, editMoved }: {
  from: string;
  to: string;
  /** Candidate referrers (repo-relative); the moved file itself is skipped. */
  sources: readonly string[];
  read: (rel: string) => string;
  exists: (rel: string) => boolean;
  editMoved?: EditMoved;
}): DocMovePlan {
  const notices: DocMoveNotice[] = [];
  // Own links keep naming the same repo path, by path arithmetic, whether or
  // not the target exists; a missing one is reported, not guessed.
  const missing = new Set<string>();
  const own = relocateLinks({
    resolveFrom: from,
    writeFrom: to,
    content: read(from),
    relocate: (target) => {
      if (target === from) return to;
      if (!exists(target)) missing.add(target);
      return target;
    },
  });
  for (const target of missing) notices.push({ path: to, line: null, message: `own link to a missing file: ${target}`, blocking: false });
  const moved: FileRewrite = {
    path: to,
    repository: repositoryOf(to),
    rewrites: own.rewrites.map((r) => ({ ...r, kind: "link" })),
    content: editMoved ? editMoved(own.content) : own.content,
  };
  if (moved.repository === "public") {
    for (const v of findPrivateLinkViolations(to, moved.content)) {
      notices.push({ path: to, line: v.line, message: `public file links into private-issues/: ${v.target}`, blocking: true });
    }
  }

  const basename = path.posix.basename(from);
  const files: FileRewrite[] = [];
  for (const rel of sources) {
    if (rel === from) continue;
    const original = read(rel);
    if (!original.includes(basename)) continue;
    const result = rewriteReferences({ rel, content: original, from, to, exists });
    notices.push(...result.notices);
    if (result.rewrites.length > 0) files.push({ path: rel, repository: repositoryOf(rel), content: result.content, rewrites: result.rewrites });
  }
  const seen = new Set<string>();
  const unique = notices.filter((n) => {
    const key = JSON.stringify(n);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { from, to, moved, files, notices: unique };
}

// Code, YAML, and shell sources whose `.md` mentions a move rewrites; doc-check
// itself does not scan shell.
const MOVE_MENTION_RE = /\.(?:ts|tsx|mts|yaml|yml|sh)$/;

// Markdown whose links doc-check maintains, and whose backticked paths too.
function pathsMaintained(rel: string, markdown: boolean): boolean {
  return (markdown || MOVE_MENTION_RE.test(rel)) && !isFilePathExempt(rel) && !rel.startsWith(AGENT_DOCS_PREFIX);
}

// References in one file that resolve to `from`, rewritten to `to`.
function rewriteReferences({ rel, content, from, to, exists }: {
  rel: string; content: string; from: string; to: string; exists: (rel: string) => boolean;
}): { content: string; rewrites: DocMoveRewrite[]; notices: DocMoveNotice[] } {
  const rewrites: DocMoveRewrite[] = [];
  const notices: DocMoveNotice[] = [];
  let out = content;
  const markdown = rel.endsWith(".md");
  const linksMaintained = markdown && isLinkScanned(rel);
  if (linksMaintained) {
    const links = relocateLinks({ resolveFrom: rel, writeFrom: rel, content: out, relocate: (t) => (t === from ? to : undefined) });
    out = links.content;
    rewrites.push(...links.rewrites.map((r) => ({ ...r, kind: "link" as const })));
  }
  if (pathsMaintained(rel, markdown)) {
    const bare = !markdown;
    const mentions = findMentionsOf({ docRel: rel, content: out, target: from, newPath: to, bare, fileExists: exists });
    for (const m of mentions.filter((p) => p.kind === "ambiguous")) {
      notices.push({ path: rel, line: m.line, message: ambiguousMessage(m.token, m.candidates ?? []), blocking: true });
    }
    const moved = mentions.filter((p) => p.kind === "moved");
    out = repairFilePaths({ content: out, problems: moved, bare });
    rewrites.push(...moved.map((m) => ({ line: m.line, from: m.token, to: m.suggestion ?? m.token, kind: "path" as const })));
    if (!markdown || linksMaintained) out = residuals({ rel, content: out, from, to, exists, linkFormsOnly: false, rewrites, notices });
  } else if (linksMaintained) {
    // A historical record keeps its backticked paths, but its links, their
    // labels, and HTML hrefs follow.
    out = residuals({ rel, content: out, from, to, exists, linkFormsOnly: true, rewrites, notices });
  }
  return { content: out, rewrites: rewrites.toSorted((a, b) => a.line - b.line), notices };
}

function ambiguousMessage(token: string, candidates: readonly string[]): string {
  return `ambiguous path \`${token}\` (matches ${candidates.join(", ")}); not rewritten`;
}

const PATH_CHAR = /[\w./~-]/;
// A character after the basename that makes the token a different path
// (`a.md.bak`, `a.mdx`, `a.md/x`, `a.md-old`). A `#anchor`, `:L3`, or
// sentence punctuation ends it.
const PATH_CONTINUES = /^(?:[\w/-]|\.\w)/;

interface PathToken { start: number; end: number; text: string }

// Each complete path-like token in `line` that ends with `basename`.
function tokensEndingWith(line: string, basename: string): PathToken[] {
  const tokens: PathToken[] = [];
  for (let at = line.indexOf(basename); at !== -1; at = line.indexOf(basename, at + basename.length)) {
    const end = at + basename.length;
    if (PATH_CONTINUES.test(line.slice(end, end + 2))) continue;
    let start = at;
    while (start > 0 && PATH_CHAR.test(line[start - 1] ?? "")) start--;
    tokens.push({ start, end, text: line.slice(start, end) });
  }
  return tokens;
}

// Half-open ranges of inline-link labels: the text of `[label](`.
function inlineLabelRanges(line: string): Array<[number, number]> {
  return [...line.matchAll(/\[([^\]]*)]\(/g)].map((m) => [m.index + 1, m.index + 1 + (m[1] ?? "").length]);
}

// Path tokens left in a maintained file that name `from`: a token ending in
// its basename that resolves to it from the file's directory, its package
// root, beebox/, or the repo root (a bare basename is a name, not a path).
// When `from` is the only existing file the token could name, it is
// rewritten to name `to` from the same base; otherwise it blocks the move.
// With `linkFormsOnly` (a historical record), only inline-link labels and
// HTML `href`s are read; a reference definition's target was already
// rewritten and its identifier is never touched.
function residuals({ rel, content, from, to, exists, linkFormsOnly, rewrites, notices }: {
  rel: string; content: string; from: string; to: string; exists: (rel: string) => boolean;
  linkFormsOnly: boolean; rewrites: DocMoveRewrite[]; notices: DocMoveNotice[];
}): string {
  const basename = path.posix.basename(from);
  const bases = [...new Set([path.posix.dirname(rel), rel.split("/")[0] ?? ".", "beebox", "."])];
  return content.split("\n").map((line, i) => {
    if (!line.includes(basename)) return line;
    const labels = inlineLabelRanges(line);
    const inLabel = (t: PathToken): boolean => labels.some(([s, e]) => t.start >= s && t.end <= e);
    let out = line;
    const found: DocMoveRewrite[] = [];
    // Right to left, so earlier offsets stay valid as tokens change length.
    for (const token of tokensEndingWith(line, basename).toReversed()) {
      if (!token.text.includes("/")) continue;
      const label = inLabel(token);
      if (linkFormsOnly && !label && !line.slice(0, token.start).endsWith('href="')) continue;
      const absolute = token.text.startsWith("/");
      const resolve = (base: string): string => path.posix.normalize(absolute ? token.text.slice(1) : path.posix.join(base, token.text));
      const tokenBases = absolute ? ["."] : bases;
      const base = tokenBases.find((b) => resolve(b) === from);
      if (base === undefined) continue;
      const named = [...new Set(tokenBases.map(resolve))].filter((r) => r === from || exists(r));
      if (named.length > 1) {
        notices.push({ path: rel, line: i + 1, message: ambiguousMessage(token.text, named), blocking: true });
        continue;
      }
      const replacement = absolute ? `/${to}` : path.posix.relative(base, to);
      out = out.slice(0, token.start) + replacement + out.slice(token.end);
      found.push({ line: i + 1, from: token.text, to: replacement, kind: label ? "label" : "prose" });
    }
    rewrites.push(...found.toReversed());
    return out;
  }).join("\n");
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

const SOURCE_RE = /\.(?:md|ts|tsx|mts|yaml|yml|sh)$/;

// Tracked and untracked-not-ignored files under `cwd`, relative to it.
function listFiles(cwd: string): string[] {
  const stdout = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd, encoding: "utf8" });
  return stdout.split("\0").filter((p) => p.length > 0);
}

// Where git runs for a repo-relative path, and the path as that repo names it.
function gitCwd(repoRoot: string, rel: string): { cwd: string; local: string } {
  return repositoryOf(rel) === "private"
    ? { cwd: path.join(repoRoot, "private-issues"), local: rel.slice(PRIVATE_PREFIX.length) }
    : { cwd: repoRoot, local: rel };
}

function normalizeRel(repoRoot: string, p: string): string {
  const rel = path.relative(repoRoot, path.resolve(repoRoot, p)).split(path.sep).join("/");
  if (rel === "" || rel.startsWith("..")) throw new OutsideRepositoryError(p);
  return rel;
}

/**
 * Resolve and validate a move. `to` naming a directory (an existing one, or
 * ending in `/`) means `to/<basename>`. Paths are relative to `repoRoot`.
 */
function resolveMove({ repoRoot, from: fromArg, to: toArg }: { repoRoot: string; from: string; to: string }): { from: string; to: string } {
  const from = normalizeRel(repoRoot, fromArg);
  const intoDir = toArg.endsWith("/") || fs.statSync(path.join(repoRoot, toArg), { throwIfNoEntry: false })?.isDirectory() === true;
  const to = normalizeRel(repoRoot, intoDir ? path.posix.join(toArg, path.posix.basename(from)) : toArg);
  if (!from.endsWith(".md")) throw new NotMarkdownError(from);
  if (!to.endsWith(".md")) throw new NotMarkdownError(to);
  if (from === to) throw new SamePathError(from);
  if (repositoryOf(from) !== repositoryOf(to)) throw new CrossRepositoryError(from, to);
  if (!fs.existsSync(path.join(repoRoot, from))) throw new MissingSourceError(from);
  if (fs.existsSync(path.join(repoRoot, to))) throw new DestinationExistsError(to);
  return { from, to };
}

function isTracked({ cwd, local }: { cwd: string; local: string }): boolean {
  const result = execFileSync("git", ["ls-files", "-z", "--", local], { cwd, encoding: "utf8" });
  return result.split("\0").includes(local);
}

// Repo-relative paths among `rels` with uncommitted changes, staged or not.
function dirtyPaths(repoRoot: string, rels: readonly string[]): string[] {
  const dirty = new Set<string>();
  for (const repository of ["public", "private"] as const) {
    const mine = rels.filter((rel) => repositoryOf(rel) === repository);
    if (mine.length === 0) continue;
    const { cwd } = gitCwd(repoRoot, mine[0] ?? "");
    const prefix = repository === "private" ? PRIVATE_PREFIX : "";
    const locals = mine.map((rel) => gitCwd(repoRoot, rel).local);
    const out = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...locals], { cwd, encoding: "utf8" });
    // Each entry is `XY path`; a rename or copy adds its source as the next field.
    const fields = out.split("\0").filter((f) => f.length > 0);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i] ?? "";
      dirty.add(`${prefix}${field.slice(3)}`);
      if (/^[CR]/.test(field)) dirty.add(`${prefix}${fields[++i] ?? ""}`);
    }
  }
  return rels.filter((rel) => dirty.has(rel));
}

export function moveDoc({ repoRoot, from: fromArg, to: toArg, dryRun, editMoved, refuseDirty }: {
  repoRoot: string;
  from: string;
  to: string;
  dryRun: boolean;
  editMoved?: EditMoved;
  /** Refuse, before any write, when a file in the move has uncommitted changes. */
  refuseDirty?: boolean;
}): DocMoveResult {
  const { from, to } = resolveMove({ repoRoot, from: fromArg, to: toArg });
  const source = gitCwd(repoRoot, from);
  if (!isTracked(source)) throw new UntrackedSourceError(from);

  const privateRoot = path.join(repoRoot, "private-issues");
  const privateFiles = fs.existsSync(privateRoot)
    ? listFiles(privateRoot).filter((p) => p.endsWith(".md")).map((p) => `${PRIVATE_PREFIX}${p}`)
    : [];
  const sources = repositoryOf(from) === "private"
    ? privateFiles
    : [...listFiles(repoRoot).filter((p) => SOURCE_RE.test(p)), ...privateFiles];
  const abs = (rel: string): string => path.join(repoRoot, rel);
  const plan = planDocMove({
    from,
    to,
    sources: sources.filter((rel) => fs.statSync(abs(rel), { throwIfNoEntry: false })?.isFile() === true),
    read: (rel) => fs.readFileSync(abs(rel), "utf8"),
    exists: (rel) => fs.existsSync(abs(rel)),
    ...(editMoved ? { editMoved } : {}),
  });
  const stage: StagePaths = { public: [], private: [] };
  for (const rel of [from, to, ...plan.files.map((f) => f.path)]) stage[repositoryOf(rel)].push(gitCwd(repoRoot, rel).local);
  const dirtyBefore = dirtyPaths(repoRoot, [from, ...plan.files.map((f) => f.path)]);
  const result: DocMoveResult = { ...plan, stage, dirtyBefore };
  if (dryRun) return result;

  const blocking = plan.notices.filter((n) => n.blocking);
  if (blocking.length > 0) throw new UnsafeReferencesError(from, blocking);
  if (refuseDirty === true && dirtyBefore.length > 0) throw new DirtyFilesError(from, dirtyBefore);
  fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
  fs.renameSync(abs(from), abs(to));
  fs.writeFileSync(abs(to), plan.moved.content, "utf8");
  for (const file of plan.files) fs.writeFileSync(abs(file.path), file.content, "utf8");
  return result;
}

function rewriteLines(file: FileRewrite): string[] {
  return file.rewrites.map((r) => `  L${String(r.line)} ${r.kind} ${r.from} -> ${r.to}`);
}

/**
 * The report every caller prints: the move, each rewritten file and line, a
 * total, and the `git add` line for each repository; notices for stderr. A
 * dry run lists blocking notices as what would refuse the move.
 */
export function formatDocMove(result: DocMoveResult, { dryRun }: { dryRun: boolean }): { stdout: string; stderr: string } {
  const verb = dryRun ? "would rewrite" : "rewrote";
  const out = [`${dryRun ? "would move" : "moved"} ${result.from} -> ${result.to}`];
  // Own links are rewritten before a caller's edit (a closing note) shifts lines.
  if (result.moved.rewrites.length > 0) out.push(`  own links, by line in ${result.from}:`, ...rewriteLines(result.moved));
  for (const file of result.files) {
    const label = file.repository === "private" && repositoryOf(result.from) === "public" ? "private-issues (commit inside that repo): " : "";
    out.push(`${label}${verb} ${file.path}`, ...rewriteLines(file));
  }
  const count = result.files.reduce((n, f) => n + f.rewrites.length, 0);
  out.push(`${String(count)} reference(s) ${dryRun ? "to rewrite" : "rewritten"} in ${String(result.files.length)} file(s)`);
  if (!dryRun) {
    out.push("not staged; stage this move with:");
    if (result.stage.public.length > 0) out.push(`  git add -A -- ${result.stage.public.join(" ")}`);
    if (result.stage.private.length > 0) out.push(`  git -C private-issues add -A -- ${result.stage.private.join(" ")}`);
  }
  if (result.dirtyBefore.length > 0) {
    out.push(`other uncommitted changes ${dryRun ? "are" : "were"} already in: ${result.dirtyBefore.join(", ")}; stage those files by hunk (git add -p)`);
  }
  const err = result.notices.map((n) => `${n.blocking ? (dryRun ? "would refuse" : "refused") : "check by hand"}: ${noticeLine(n)}`);
  return { stdout: `${out.join("\n")}\n`, stderr: err.length > 0 ? `${err.join("\n")}\n` : "" };
}
