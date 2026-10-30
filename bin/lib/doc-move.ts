/**
 * Move one Markdown doc and rewrite every reference to it — the shared
 * operation behind closing an issue (`bin/issues close`) and landing a plan
 * (`bin/doc-move`).
 *
 * `doc-check --fix` repairs any broken link anywhere by unique basename, a
 * guess run over the whole working tree. A move knows exactly which file
 * moved, so it rewrites only references that resolve to that file's old path:
 * Markdown links and frontmatter paths, backticked repo paths in Markdown, and
 * `.md` mentions in code and YAML, test files included. The moved file's own
 * relative links are re-expressed from its new directory. Which files are read
 * for which kind of reference follows doc-check (beebox/src/dev/doc-check/scan-scope.ts).
 *
 * Whatever it cannot rewrite with certainty it reports as a notice: an own
 * link to a missing file, a path token that two files could answer to, and any
 * remaining token that still resolves to the old path in a form the scanners
 * do not parse (a reference-style link, an HTML href). doc-check is no safety
 * net for those: its graph resolves a stale link by basename.
 *
 * `private-issues/` is a separate repository mounted at the monorepo root. A
 * move never crosses repositories. A private move reads only private files;
 * a public move also reads private Markdown, since a private file may link to
 * a public one (never the reverse).
 *
 * `planDocMove` is pure (reads injected); `moveDoc` adds `git mv` and writes.
 * Every refusal happens before anything is written.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { relocateLinks, type LinkRewrite } from "../../beebox/src/dev/doc-check/link-repair.js";
import { findMentionsOf, repairFilePaths } from "../../beebox/src/dev/doc-check/file-paths.js";
import { AGENT_DOCS_PREFIX, MENTION_SOURCE_RE, isFilePathExempt, isLinkScanned } from "../../beebox/src/dev/doc-check/scan-scope.js";

export const PRIVATE_PREFIX = "private-issues/";

export type Repository = "public" | "private";

export interface DocMoveRewrite extends LinkRewrite {
  kind: "link" | "path";
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

export class DocMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocMoveError";
  }
}
class NotMarkdownError extends DocMoveError {
  constructor(p: string) { super(`${p}: only a .md file can be moved`); this.name = "NotMarkdownError"; }
}
class MissingSourceError extends DocMoveError {
  constructor(from: string) { super(`${from}: no such file`); this.name = "MissingSourceError"; }
}
class DestinationExistsError extends DocMoveError {
  constructor(to: string) { super(`${to}: destination already exists`); this.name = "DestinationExistsError"; }
}
class SamePathError extends DocMoveError {
  constructor(from: string) { super(`${from}: source and destination are the same`); this.name = "SamePathError"; }
}
class CrossRepositoryError extends DocMoveError {
  constructor(from: string, to: string) { super(`${from} -> ${to}: a move cannot cross between the monorepo and private-issues/ (separate repositories)`); this.name = "CrossRepositoryError"; }
}
class UntrackedSourceError extends DocMoveError {
  constructor(from: string) { super(`${from}: not tracked by git; git add it first`); this.name = "UntrackedSourceError"; }
}
class OutsideRepositoryError extends DocMoveError {
  constructor(p: string) { super(`${p}: path is outside the repository`); this.name = "OutsideRepositoryError"; }
}

export function repositoryOf(rel: string): Repository {
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
  for (const target of missing) notices.push({ path: to, line: null, message: `own link to a missing file: ${target}` });
  const moved: FileRewrite = {
    path: to,
    repository: repositoryOf(to),
    rewrites: own.rewrites.map((r) => ({ ...r, kind: "link" })),
    content: editMoved ? editMoved(own.content) : own.content,
  };

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
  return { from, to, moved, files, notices };
}

// Markdown whose links doc-check maintains, and whose backticked paths too.
function pathsMaintained(rel: string, markdown: boolean): boolean {
  return (markdown || MENTION_SOURCE_RE.test(rel)) && !isFilePathExempt(rel) && !rel.startsWith(AGENT_DOCS_PREFIX);
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
      notices.push({ path: rel, line: m.line, message: `ambiguous path \`${m.token}\` (matches ${(m.candidates ?? []).join(", ")}); not rewritten` });
    }
    const moved = mentions.filter((p) => p.kind === "moved");
    out = repairFilePaths({ content: out, problems: moved, bare });
    rewrites.push(...moved.map((m) => ({ line: m.line, from: m.token, to: m.suggestion ?? m.token, kind: "path" as const })));
    if (!markdown || linksMaintained) notices.push(...residualReferences({ rel, content: out, from }));
  }
  return { content: out, rewrites: rewrites.toSorted((a, b) => a.line - b.line), notices };
}

const PATH_CHAR = /[\w./~-]/;

// Each path-like token in `line` that ends with `basename`.
function tokensEndingWith(line: string, basename: string): string[] {
  const tokens: string[] = [];
  for (let at = line.indexOf(basename); at !== -1; at = line.indexOf(basename, at + basename.length)) {
    let start = at;
    while (start > 0 && PATH_CHAR.test(line[start - 1] ?? "")) start--;
    tokens.push(line.slice(start, at + basename.length));
  }
  return tokens;
}

// Tokens left in a maintained file that still name `from`: a path ending in
// its basename that resolves to it from the file's directory, its package
// root, beebox/, or the repo root. A bare basename is a name, not a path.
function residualReferences({ rel, content, from }: { rel: string; content: string; from: string }): DocMoveNotice[] {
  const basename = path.posix.basename(from);
  const bases = [...new Set([path.posix.dirname(rel), rel.split("/")[0] ?? ".", "beebox", "."])];
  const notices: DocMoveNotice[] = [];
  for (const [i, line] of content.split("\n").entries()) {
    for (const token of tokensEndingWith(line, basename)) {
      if (!token.includes("/")) continue;
      if (!bases.some((base) => path.posix.normalize(path.posix.join(base, token)) === from)) continue;
      notices.push({ path: rel, line: i + 1, message: `still names the old path: ${token}` });
    }
  }
  return notices;
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

const SOURCE_RE = /\.(?:md|ts|tsx|mts|yaml|yml)$/;

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
export function resolveMove({ repoRoot, from: fromArg, to: toArg }: { repoRoot: string; from: string; to: string }): { from: string; to: string } {
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

export function moveDoc({ repoRoot, from: fromArg, to: toArg, dryRun, editMoved }: {
  repoRoot: string;
  from: string;
  to: string;
  dryRun: boolean;
  editMoved?: EditMoved;
}): DocMovePlan {
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
  if (dryRun) return plan;

  fs.mkdirSync(path.dirname(abs(to)), { recursive: true });
  execFileSync("git", ["mv", "--", source.local, gitCwd(repoRoot, to).local], { cwd: source.cwd, stdio: ["ignore", "ignore", "inherit"] });
  fs.writeFileSync(abs(to), plan.moved.content, "utf8");
  for (const file of plan.files) fs.writeFileSync(abs(file.path), file.content, "utf8");
  return plan;
}

function rewriteLines(file: FileRewrite): string[] {
  return file.rewrites.map((r) => `  L${String(r.line)} ${r.kind} ${r.from} -> ${r.to}`);
}

/** The report both CLIs print: the move, each rewritten file and line, a total, and notices for stderr. */
export function formatDocMove(plan: DocMovePlan, { dryRun }: { dryRun: boolean }): { stdout: string; stderr: string } {
  const verb = dryRun ? "would rewrite" : "rewrote";
  const out = [`${dryRun ? "would move" : "moved"} ${plan.from} -> ${plan.to}`, ...rewriteLines(plan.moved)];
  for (const file of plan.files) {
    const label = file.repository === "private" && repositoryOf(plan.from) === "public" ? "private-issues (commit inside that repo): " : "";
    out.push(`${label}${verb} ${file.path}`, ...rewriteLines(file));
  }
  const count = plan.files.reduce((n, f) => n + f.rewrites.length, 0);
  out.push(`${String(count)} reference(s) ${dryRun ? "to rewrite" : "rewritten"} in ${String(plan.files.length)} file(s)`);
  const err = plan.notices.map((n) => `check by hand: ${n.path}${n.line === null ? "" : `:L${String(n.line)}`}: ${n.message}`);
  return { stdout: `${out.join("\n")}\n`, stderr: err.length > 0 ? `${err.join("\n")}\n` : "" };
}
