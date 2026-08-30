#!/usr/bin/env node --import tsx
/**
 * Commit provenance trailers (`pnpm commit-provenance`): stamps, validates and
 * queries the `Workstream:` / `Plan:` / `Issue:` trailers on monorepo commits.
 * Plan: beebox/docs/plans/commit-provenance-trailers.md.
 *
 * Three roles, one script:
 *
 *   --prepare <msgfile> [source]   `.husky/prepare-commit-msg`. On a
 *       `worktree-<name>` branch, stamps `Workstream: <name>`, plus
 *       `Plan: <basename>` when exactly one active plan in
 *       `beebox/docs/plans/` claims that workstream in its frontmatter.
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
 *       serving a private issue carries no `Issue:`. Keys are case-sensitive
 *       here: the queries grep the canonical spelling, so `issue:` is rejected
 *       rather than stamped into history where nothing would find it.
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
import { splitFrontmatter } from "../beebox/src/dev/doc-frontmatter.js";
import { errnoCode, errorMessage } from "../beebox/src/lib/error-guards.js";

/** Active plans only — implemented plans are finished and unimplemented ones are parked/superseded. */
const PLANS_DIR = "beebox/docs/plans";
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

/** The three provenance keys, in their one canonical spelling. */
const KEYS = ["Workstream", "Plan", "Issue"];

/** `[key, value]` for every line of `git interpret-trailers --parse` output. */
function parsedTrailers(parsed: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of parsed.split("\n")) {
    const match = /^([\w-]+):[\t ]*(.*)$/.exec(line);
    if (match !== null) out.push([match[1]!, match[2]!.trim()]);
  }
  return out;
}

/**
 * Values of one provenance key — matched EXACTLY. The queries grep for the
 * canonical spelling, so a `issue:` trailer would be stamped into history and
 * then never found; `miscasedKeys` turns that into a commit-time error instead.
 */
export function trailerValues(parsed: string, key: string): string[] {
  return parsedTrailers(parsed).filter(([k]) => k === key).map(([, value]) => value);
}

/** Trailer keys that are a provenance key in the wrong case (`issue:`, `PLAN:`). */
export function miscasedKeys(parsed: string): string[] {
  const out: string[] = [];
  for (const [key] of parsedTrailers(parsed)) {
    const canonical = KEYS.find((k) => k.toLowerCase() === key.toLowerCase());
    if (canonical !== undefined && canonical !== key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Every issue, as basename (without `.md`) -> path relative to `issuesDir`.
 *
 * Only real issue files count — `issues/<category>/<name>.md` and
 * `issues/closed/<category>/<name>.md` — so the queue's own prose
 * (`issues/CLAUDE.md`, `issues/closed/README.md`) can never be cited as an
 * issue.
 *
 * The basename IS an issue's identity, repo-wide: `issues/CLAUDE.md` requires
 * it to be unique, which is why an `Issue:` trailer names one bare and why a
 * `git mv` into `closed/` does not break a citation. That makes this map the
 * way to find where an issue lives NOW, given only its name.
 */
export function issueFiles(issuesDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const isIssuePath = (rel: string): boolean => {
    const parts = rel.split(path.sep);
    if (parts.length === 2) return parts[0] !== "closed"; // issues/<category>/<name>.md
    return parts.length === 3 && parts[0] === "closed"; // issues/closed/<category>/<name>.md
  };
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = path.relative(issuesDir, full);
        if (isIssuePath(rel)) out.set(entry.name.slice(0, -3), rel);
      }
    }
  };
  walk(issuesDir);
  return out;
}

/** Every issue basename, `closed/` included. See {@link issueFiles}. */
export function issueBasenames(issuesDir: string): string[] {
  return [...issueFiles(issuesDir).keys()];
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
  const miscased = miscasedKeys(parsed);
  if (miscased.length > 0) {
    console.error("commit-provenance: provenance trailer keys are case-sensitive — the queries look for the exact spelling:");
    for (const key of miscased) {
      const canonical = KEYS.find((k) => k.toLowerCase() === key.toLowerCase())!;
      console.error(`  ${key}: -> use \`${canonical}:\``);
    }
    process.exit(1);
  }
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

/**
 * Keep only the commits whose real trailer block carries `value` under `key`.
 * `--grep` alone would match a body sentence that happens to start "Issue: ..."
 * — the same prose `--check` deliberately ignores — so each candidate is
 * re-read through `%(trailers:key=…,valueonly)`, git's own trailer parser.
 * Record layout: `<oneline>\0<value>\x1f<value>…`.
 */
export function filterByTrailer(records: string, value: string): string[] {
  const out: string[] = [];
  for (const record of records.split("\n")) {
    if (record === "") continue;
    const [oneline, values] = record.split("\0");
    if (oneline === undefined || values === undefined) continue;
    if (values.split("\u001F").map((v) => v.trim()).includes(value)) out.push(oneline);
  }
  return out;
}

function query(params: { key: string; value: string; mainOnly: boolean }): void {
  const { key, value, mainOnly } = params;
  const pattern = `^${key}: ${value.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&")}$`;
  const format = `--format=%h %s%x00%(trailers:key=${key},valueonly,unfold,separator=%x1f)`;
  const args = ["log", "--extended-regexp", `--grep=${pattern}`, format];
  args.push(mainOnly ? "main" : "--all");
  let out: string;
  try {
    out = git(args, repoRoot());
  } catch (e) {
    // A checkout with no `main` ref is the realistic failure; report it as one line.
    console.error(`commit-provenance: ${errorMessage(e).split("\n")[0]}`);
    process.exit(1);
  }
  const lines = filterByTrailer(out, value);
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
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
