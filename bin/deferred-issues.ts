import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { execa } from "execa";

import {
  ISSUE_CATEGORIES, parseFrontmatter, type IssueCategory,
} from "../workstreams-app/src/server/issue-domain.js";
import {
  buildBasenameLookup,
  repairFrontmatterPaths,
  repairLinks,
} from "../beebox/src/dev/doc-link-repair.js";
import { errnoCode } from "../beebox/src/lib/error-guards.js";

const DATE_RE = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

export interface DeferredIssue {
  file: string;
  activateOn: string;
  category: IssueCategory;
}

export interface ActivatedIssue {
  source: string;
  destination: string;
}

export class DeferredIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferredIssueError";
  }
}

class InvalidDeferredMetadataError extends DeferredIssueError {
  constructor(file: string, problems: string[]) { super(`${file}: ${problems.join("; ")}`); this.name = "InvalidDeferredMetadataError"; }
}
class MissingDeferredFrontmatterError extends DeferredIssueError {
  constructor() { super("deferred issue has no YAML frontmatter"); this.name = "MissingDeferredFrontmatterError"; }
}
class UnterminatedDeferredFrontmatterError extends DeferredIssueError {
  constructor() { super("deferred issue has unterminated YAML frontmatter"); this.name = "UnterminatedDeferredFrontmatterError"; }
}
class NestedDeferredDirectoryError extends DeferredIssueError {
  constructor(root: string, names: string[]) { super(`${root}: deferred/ must be flat (found ${names.join(", ")})`); this.name = "NestedDeferredDirectoryError"; }
}
class ActivationDestinationExistsError extends DeferredIssueError {
  constructor(destination: string) { super(`activation destination already exists: ${destination}`); this.name = "ActivationDestinationExistsError"; }
}
class InvalidActivationDateError extends DeferredIssueError {
  constructor(date: string) { super(`invalid activation date: ${date}`); this.name = "InvalidActivationDateError"; }
}
class DirtyActivationRepositoryError extends DeferredIssueError {
  constructor(root: string) { super(`${root}: refusing to activate into a dirty repository`); this.name = "DirtyActivationRepositoryError"; }
}
class NonMarkdownActivationChangeError extends DeferredIssueError {
  constructor(root: string, files: string[]) { super(`${root}: activation changed non-Markdown files: ${files.join(", ")}`); this.name = "NonMarkdownActivationChangeError"; }
}
export function isCalendarDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match?.groups) return false;
  const year = Number(match.groups["year"]);
  const month = Number(match.groups["month"]);
  const day = Number(match.groups["day"]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localDate(at: Date): string {
  const part = (value: number): string => String(value).padStart(2, "0");
  return `${String(at.getFullYear())}-${part(at.getMonth() + 1)}-${part(at.getDate())}`;
}

function scalar(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function parseDeferredIssue(file: string, source: string): DeferredIssue {
  const { data } = parseFrontmatter(source);
  const activateOn = scalar(data["activate-on"]);
  const category = scalar(data.category);
  const problems: string[] = [];
  if (activateOn === null || !isCalendarDate(activateOn)) problems.push("activate-on must be a valid YYYY-MM-DD date");
  const parsedCategory = ISSUE_CATEGORIES.find((candidate) => candidate === category);
  if (parsedCategory === undefined) {
    problems.push(`category must be one of ${ISSUE_CATEGORIES.join(", ")}`);
  }
  if (problems.length > 0 || activateOn === null || parsedCategory === undefined) {
    throw new InvalidDeferredMetadataError(file, problems);
  }
  return { file, activateOn, category: parsedCategory };
}

/** Remove deferred-only scalar fields without reserializing the rest of YAML. */
export function activatedSource(source: string): string {
  const lines = source.split("\n");
  if ((lines[0] ?? "").trim() !== "---") throw new MissingDeferredFrontmatterError();
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) throw new UnterminatedDeferredFrontmatterError();
  const kept = lines.filter((line, index) =>
    index > end || !/^(?:activate-on|category):/u.test(line));
  return kept.join("\n");
}

async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path.relative(root, target).split(path.sep).join("/"));
    }
  };
  await visit(root);
  return files.toSorted();
}

export async function readDeferredIssues(issuesRoot: string): Promise<DeferredIssue[]> {
  const deferredRoot = path.join(issuesRoot, "deferred");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(deferredRoot, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return [];
    throw error;
  }
  const nested = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (nested.length > 0) throw new NestedDeferredDirectoryError(deferredRoot, nested);
  const issues: DeferredIssue[] = [];
  for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".md")).toSorted((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(deferredRoot, entry.name);
    issues.push(parseDeferredIssue(file, await fs.readFile(file, "utf8")));
  }
  return issues;
}

export async function activateDeferredRoot(options: {
  issuesRoot: string;
  today: string;
  dryRun: boolean;
}): Promise<ActivatedIssue[]> {
  if (!isCalendarDate(options.today)) throw new InvalidActivationDateError(options.today);
  const due = (await readDeferredIssues(options.issuesRoot)).filter((issue) => issue.activateOn <= options.today);
  const moves = due.map((issue) => ({
    source: issue.file,
    destination: path.join(options.issuesRoot, issue.category, path.basename(issue.file)),
  }));
  for (const move of moves) {
    try {
      await fs.stat(move.destination);
      throw new ActivationDestinationExistsError(move.destination);
    } catch (error) {
      if (error instanceof DeferredIssueError) throw error;
      if (errnoCode(error) !== "ENOENT") throw error;
    }
  }
  if (options.dryRun) return moves;
  for (const move of moves) {
    const source = await fs.readFile(move.source, "utf8");
    await fs.mkdir(path.dirname(move.destination), { recursive: true });
    await fs.writeFile(move.destination, activatedSource(source), "utf8");
    await fs.unlink(move.source);
  }
  return moves;
}

async function assertClean(repoRoot: string): Promise<void> {
  const result = await execa("git", ["status", "--porcelain"], { cwd: repoRoot });
  if (result.stdout !== "") throw new DirtyActivationRepositoryError(repoRoot);
}

async function restoreCleanRepository(repoRoot: string): Promise<void> {
  const untracked = await execa("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot });
  const untrackedMarkdown = untracked.stdout.split("\n").filter((file) => file.endsWith(".md"));
  await execa("git", ["reset", "-q"], { cwd: repoRoot });
  await execa("git", ["restore", "--worktree", "--", "."], { cwd: repoRoot });
  await Promise.all(untrackedMarkdown.map(async (file) => {
    try {
      await fs.unlink(path.join(repoRoot, file));
    } catch (error) {
      // Another cleanup may already have removed the untracked activation output.
      if (errnoCode(error) !== "ENOENT") throw error;
    }
  }));
}

export async function runActivationTransaction<T>(repoRoot: string, operation: () => Promise<T>): Promise<T> {
  await assertClean(repoRoot);
  try {
    return await operation();
  } catch (error) {
    await restoreCleanRepository(repoRoot);
    throw error;
  }
}

async function changedMarkdown(repoRoot: string): Promise<string[]> {
  const [tracked, staged, untracked] = await Promise.all([
    execa("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB"], { cwd: repoRoot }),
    execa("git", ["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB"], { cwd: repoRoot }),
    execa("git", ["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot }),
  ]);
  const changed = [
    ...tracked.stdout.split("\n"), ...staged.stdout.split("\n"), ...untracked.stdout.split("\n"),
  ].filter(Boolean);
  const nonMarkdown = changed.filter((file) => !file.endsWith(".md"));
  if (nonMarkdown.length > 0) throw new NonMarkdownActivationChangeError(repoRoot, nonMarkdown);
  return [...new Set(changed)].toSorted();
}

async function commitChanges(repoRoot: string, message: string): Promise<void> {
  const changed = await changedMarkdown(repoRoot);
  if (changed.length === 0) return;
  await execa("git", ["add", "-A", "--", ...changed], { cwd: repoRoot });
  // The commit's stdout goes to OUR stderr, never inherited: this runs under
  // `bin/issues activate-due --json`, whose stdout is the JSON a schedule
  // parses, and the pre-commit hook's `> beebox@0.1.0 doc-check` banner on an
  // inherited stdout broke that parse the first time an activation fired
  // (2026-09-07). Hook output stays visible, on the stream for diagnostics.
  const commit = await execa("git", ["commit", "-m", message], { cwd: repoRoot, stderr: "inherit" });
  if (commit.stdout !== "") process.stderr.write(`${commit.stdout}\n`);
}

async function repairPrivateLinks(privateRoot: string): Promise<void> {
  const files = await markdownFiles(privateRoot);
  const lookup = buildBasenameLookup(files);
  const exists = (rel: string): boolean => files.includes(rel);
  for (const rel of files) {
    const target = path.join(privateRoot, rel);
    const source = await fs.readFile(target, "utf8");
    const frontmatter = repairFrontmatterPaths({ fromRel: rel, content: source, fileExists: exists, basenameLookup: lookup });
    const markdown = repairLinks({ fromRel: rel, content: frontmatter.content, fileExists: exists, basenameLookup: lookup });
    // Private issues have no repo-wide doc-check gate. Repair every uniquely
    // resolvable move, but do not make an unrelated old broken link prevent a
    // due issue from activating.
    if (markdown.content !== source) await fs.writeFile(target, markdown.content, "utf8");
  }
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return false;
    throw error;
  }
}

export async function activateDueRepositories(options: {
  repoRoot: string;
  today?: string;
  dryRun: boolean;
  visibility?: "public" | "private" | null;
}): Promise<{ public: ActivatedIssue[]; private: ActivatedIssue[] }> {
  const today = options.today ?? localDate(new Date());
  const publicIssues = path.join(options.repoRoot, "issues");
  const privateIssues = path.join(options.repoRoot, "private-issues");
  const includePublic = options.visibility !== "private";
  const includePrivate = options.visibility !== "public";
  const publicDue = includePublic
    ? await activateDeferredRoot({ issuesRoot: publicIssues, today, dryRun: true })
    : [];
  if (!options.dryRun && publicDue.length > 0) {
    await runActivationTransaction(options.repoRoot, async () => {
      await activateDeferredRoot({ issuesRoot: publicIssues, today, dryRun: false });
      // doc-check's basename lookup is index-backed. Stage the rename first so
      // the destination is the issue's current location during link repair.
      await execa("git", ["add", "-A", "--", "issues"], { cwd: options.repoRoot });
      await execa("pnpm", ["--dir", "beebox", "doc-check", "--fix"], {
        cwd: options.repoRoot, stdout: "inherit", stderr: "inherit",
      });
      await commitChanges(options.repoRoot, "Activate deferred issues");
    });
  }
  const privateDue = includePrivate && await directoryExists(privateIssues)
    ? await activateDeferredRoot({ issuesRoot: privateIssues, today, dryRun: true })
    : [];
  if (!options.dryRun && privateDue.length > 0) {
    const { stdout } = await execa("git", ["rev-parse", "--show-toplevel"], { cwd: privateIssues });
    const privateRepo = stdout.trim();
    await runActivationTransaction(privateRepo, async () => {
      await activateDeferredRoot({ issuesRoot: privateIssues, today, dryRun: false });
      await repairPrivateLinks(privateRepo);
      await commitChanges(privateRepo, "Activate deferred issues");
    });
  }
  return { public: publicDue, private: privateDue };
}
