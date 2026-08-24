#!/usr/bin/env node --import tsx
/**
 * Commit provenance trailers (`pnpm commit-provenance`): stamps, validates and
 * queries the `Workstream:` / `Plan:` / `Issue:` trailers on monorepo commits.
 * Plan: callback-box/docs/plans/commit-provenance-trailers.md.
 *
 * Three roles, one script:
 *
 *   --prepare <msgfile> [source]   `.husky/prepare-commit-msg`. On a
 *       `worktree-<name>` branch, stamps `Workstream: <name>`, plus
 *       `Plan: <basename>` when exactly one active plan in
 *       `callback-box/docs/plans/` claims that workstream in its frontmatter.
 *       Idempotent (`git interpret-trailers --if-exists replace`), so amend and
 *       reword keep one trailer per key. Silent on success; ANY failure prints
 *       one stderr line and exits 0 — provenance must never block a commit.
 *
 *   --check <msgfile>              `.husky/commit-msg`. Every `Issue:` trailer
 *       must name an existing `issues/**\/<value>.md`. This is the one boundary
 *       where a typo is still fixable: commits are immutable, and a misspelled
 *       issue name is a permanent dangling link. Zero `Issue:` trailers is fine
 *       (the trailer is optional and hand-written). `private-issues/` is NEVER
 *       searched — a private slug in public history is a leak, so a commit
 *       serving a private issue carries no `Issue:`.
 *
 *   --workstream|--plan|--issue <name> [--main]
 *       `git log --oneline` of the commits carrying that trailer, across all
 *       refs by default (unlanded stream work is visible) or `main` only.
 *
 * Trailers are parsed with `git interpret-trailers --parse`, not a line regex:
 * a body sentence beginning "Issue: ..." is prose, not a trailer.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { splitFrontmatter } from "../callback-box/src/dev/doc-frontmatter.js";
import { errnoCode, errorMessage } from "../callback-box/src/lib/error-guards.js";

/** Active plans only — implemented plans are finished and unimplemented ones are parked/superseded. */
const PLANS_DIR = "callback-box/docs/plans";
const ISSUES_DIR = "issues";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

function repoRoot(): string {
  return git(["rev-parse", "--show-toplevel"], process.cwd()).trim();
}

/** `worktree-foo` -> `foo`; anything else (main, a detached HEAD's "HEAD") -> null. */
export function workstreamFromBranch(branch: string): string | null {
  const match = /^worktree-(.+)$/.exec(branch.trim());
  return match === null ? null : match[1]!;
}

/**
 * The single active plan claiming `workstream`, as a bare basename. Zero or
 * several matches -> null: `Plan:` is omitted rather than guessed (a stream with
 * several active plans is itself the anomaly; `--workstream` still finds the
 * commits).
 */
export function resolvePlan(plansDir: string, workstream: string): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(plansDir);
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null; // no plans dir in this checkout
    throw e;
  }
  const matches: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const doc = splitFrontmatter(fs.readFileSync(path.join(plansDir, name), "utf8"));
    if (doc !== null && doc.data.workstream === workstream) matches.push(name.slice(0, -3));
  }
  return matches.length === 1 ? matches[0]! : null;
}

/** Apply each trailer to the message file, replacing any existing one with that key. */
function stampTrailers(root: string, params: { msgFile: string; trailers: Array<[string, string]> }): void {
  const { msgFile, trailers } = params;
  if (trailers.length === 0) return;
  const args = ["interpret-trailers", "--in-place", "--if-exists", "replace"];
  for (const [key, value] of trailers) args.push("--trailer", `${key}=${value}`);
  args.push(msgFile);
  git(args, root);
}

/** The current branch, or null when HEAD is detached (mid-rebase, bisect). */
function currentBranch(root: string): string | null {
  try {
    return git(["symbolic-ref", "--quiet", "--short", "HEAD"], root).trim();
  } catch (_e) {
    /* ignore: detached HEAD — symbolic-ref exits 1, and no branch means no workstream */
    return null;
  }
}

function prepare(msgFile: string, source: string): void {
  // A squash message concatenates already-stamped messages; stale inner
  // trailers in the body would mislead more than a missing one.
  if (source === "squash") return;
  const root = repoRoot();
  const branch = currentBranch(root);
  if (branch === null) return;
  const workstream = workstreamFromBranch(branch);
  if (workstream === null) return; // main, or any non-worktree branch
  const trailers: Array<[string, string]> = [["Workstream", workstream]];
  const plan = resolvePlan(path.join(root, PLANS_DIR), workstream);
  if (plan !== null) trailers.push(["Plan", plan]);
  stampTrailers(root, { msgFile, trailers });
}

/** Values of one trailer key, from `git interpret-trailers --parse` output. */
export function trailerValues(parsed: string, key: string): string[] {
  const out: string[] = [];
  for (const line of parsed.split("\n")) {
    const match = /^([\w-]+):[ \t]*(.*)$/.exec(line);
    if (match !== null && match[1]!.toLowerCase() === key.toLowerCase()) out.push(match[2]!.trim());
  }
  return out;
}

/** Every issue basename (without `.md`) under `issues/`, including `closed/`. */
export function issueBasenames(issuesDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.isFile() && entry.name.endsWith(".md")) out.push(entry.name.slice(0, -3));
    }
  };
  walk(issuesDir);
  return out;
}

/** Up to three known basenames sharing the longest prefix with `name`. */
export function nearestIssues(known: string[], name: string): string[] {
  const scored: Array<{ basename: string; shared: number }> = [];
  for (const basename of known) {
    let shared = 0;
    while (shared < basename.length && shared < name.length && basename[shared] === name[shared]) shared++;
    if (shared >= 4) scored.push({ basename, shared });
  }
  scored.sort((a, b) => (b.shared - a.shared) || a.basename.localeCompare(b.basename));
  return scored.slice(0, 3).map((s) => s.basename);
}

export interface IssueProblem {
  /** The trailer value exactly as written. */
  value: string;
  /** The bare-name form, when the value was given as a path and/or with `.md`. */
  bare: string | null;
  /** Whether that bare-name form does name a real issue (so the fix is just the spelling). */
  bareExists: boolean;
  suggestions: string[];
}

/** One problem per `Issue:` value naming no file under `issues/`. */
export function checkIssueTrailers(parsed: string, issuesDir: string): IssueProblem[] {
  const values = trailerValues(parsed, "Issue");
  if (values.length === 0) return [];
  const known = issueBasenames(issuesDir);
  const problems: IssueProblem[] = [];
  for (const value of values) {
    if (known.includes(value)) continue;
    const bare = path.basename(value).replace(/\.md$/, "");
    problems.push({
      value,
      bare: bare === value ? null : bare,
      bareExists: known.includes(bare),
      suggestions: nearestIssues(known, bare),
    });
  }
  return problems;
}

function check(msgFile: string): void {
  const root = repoRoot();
  const parsed = git(["interpret-trailers", "--parse", msgFile], root);
  const problems = checkIssueTrailers(parsed, path.join(root, ISSUES_DIR));
  if (problems.length === 0) return;
  console.error("commit-provenance: Issue: trailer names no issue file:");
  for (const problem of problems) {
    console.error(`  Issue: ${problem.value}`);
    if (problem.bare !== null) {
      const suffix = problem.bareExists ? "" : " (also unknown)";
      console.error(`    use the bare name, no path and no .md: Issue: ${problem.bare}${suffix}`);
    }
    for (const suggestion of problem.suggestions) console.error(`    did you mean: ${suggestion}`);
  }
  console.error(`No file matches under ${ISSUES_DIR}/ (closed/ included). Private issues are never referenced — drop the trailer instead.`);
  process.exit(1);
}

const QUERY_KEYS: Record<string, string> = { "--workstream": "Workstream", "--plan": "Plan", "--issue": "Issue" };

function query(params: { key: string; value: string; mainOnly: boolean }): void {
  const { key, value, mainOnly } = params;
  const pattern = `^${key}: ${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
  const args = ["log", "--oneline", "--extended-regexp", `--grep=${pattern}`];
  args.push(mainOnly ? "main" : "--all");
  let out: string;
  try {
    out = git(args, repoRoot());
  } catch (e) {
    // A checkout with no `main` ref is the realistic failure; report it as one line.
    console.error(`commit-provenance: ${errorMessage(e).split("\n")[0]}`);
    process.exit(1);
  }
  if (out !== "") process.stdout.write(out);
}

function usage(): never {
  console.error("usage: commit-provenance --prepare <msgfile> [source] | --check <msgfile> | --workstream|--plan|--issue <name> [--main]");
  process.exit(2);
}

function main(argv: string[]): void {
  const mode = argv[0];
  if (mode === undefined) usage();
  if (mode === "--prepare") {
    const msgFile = argv[1];
    if (msgFile === undefined) usage();
    // Never block a commit: report the failure and let git proceed.
    try {
      prepare(msgFile, argv[2] ?? "");
    } catch (e) {
      console.error(`commit-provenance: could not stamp trailers: ${errorMessage(e).split("\n")[0]}`);
    }
    return;
  }
  if (mode === "--check") {
    const msgFile = argv[1];
    if (msgFile === undefined) usage();
    check(msgFile);
    return;
  }
  const key = QUERY_KEYS[mode];
  if (key === undefined) usage();
  const value = argv[1];
  if (value === undefined || value.startsWith("--")) usage();
  const rest = argv.slice(2);
  if (rest.some((arg) => arg !== "--main")) usage();
  query({ key, value, mainOnly: rest.includes("--main") });
}

// Run only as a script, not when imported by the test.
if (process.argv[1] !== undefined && process.argv[1].endsWith("commit-provenance.ts")) {
  main(process.argv.slice(2));
}
