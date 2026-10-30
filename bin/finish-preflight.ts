/**
 * `/finish` steps 1–3 plus the classification, as one command: confirm the
 * worktree and the private leg, list stragglers, merge `main`, then print the
 * decision sheet every later step keys off.
 *
 *   bin/finish-preflight             # short text block
 *   bin/finish-preflight --json      # the sheet
 *   bin/finish-preflight --no-merge  # re-read the sheet without merging again
 *   bin/finish-preflight --help
 *
 * Exit: 0 sheet printed, 2 wrong place / broken private mount / bad arguments,
 * 3 merge conflict.
 *
 * See beebox/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanism E2.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { git, gitBranch, gitTopLevel } from "./lib/git.js";
import { changedPaths } from "./test-git.js";
import { packageOwnerDirs } from "./workspace-packages.js";
import { mergeMain, type MergeResult } from "./finish-preflight-merge.js";
import { selection, type SelectedTests } from "./finish-preflight-select.js";
import {
  NotAWorktreeBranchError,
  PreflightError,
  PrivateMountUnhealthyError,
  UsageError,
} from "./finish-preflight-errors.js";
import {
  hasCodeChange,
  isDocPath,
  isDocsOnly,
  isTestPath,
  groupPaths,
  parseTrailers,
  skipTypecheckLintDecision,
  type SkipInput,
  trackORecommendation,
  verificationCommands,
  type VerificationCommand,
} from "./finish-preflight-lib.js";

export interface Sheet {
  worktree: string;
  branch: string;
  repoRoot: string;
  privateLeg: { active: boolean; state: string; repo: string | null };
  stragglers: string[];
  merge: MergeResult;
  changed: { all: string[]; byGroup: Record<string, string[]>; unknownGroups: string[] };
  docsOnly: boolean;
  codeChanged: boolean;
  /** Null when beebox is untouched. */
  selectedTests: SelectedTests | null;
  verification: VerificationCommand[];
  skipTypecheckLint: { value: boolean; reason: string; rule: string };
  plan: { attached: boolean; docs: string[]; trailers: string[] };
  issues: string[];
  diff: { lines: number; sourceLines: number };
  trackO: { recommended: boolean; reason: string };
}

const SKIP_RULE =
  "pre-commit typechecks and lints what each worktree commit stages, so a finish needs them again " +
  "only for an uncommitted straggler, or when a merge brought code and the branch has code of its own " +
  "(a non-.md path in a branch commit, a merge edit, or HEAD vs main). " +
  "`--no-verify` leaves no git evidence and is not detectable.";

function hasScriptIn(root: string): (pkg: string, script: string) => boolean {
  const cache = new Map<string, Set<string>>();
  return (pkg, script) => {
    let scripts = cache.get(pkg);
    if (scripts === undefined) {
      const file = join(root, pkg, "package.json");
      const parsed: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : {};
      const raw =
        typeof parsed === "object" && parsed !== null && "scripts" in parsed
          ? parsed.scripts
          : undefined;
      scripts = new Set(
        typeof raw === "object" && raw !== null ? Object.keys(raw) : [],
      );
      cache.set(pkg, scripts);
    }
    return scripts.has(script);
  };
}

function privateLeg(root: string): Sheet["privateLeg"] {
  const result = spawnSync(join(root, "bin/private-issues"), ["status", "."], {
    cwd: root,
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    return { active: false, state: "no-repo", repo: null };
  }
  const out = result.stdout.trim();
  const state = /state=(\S+)/.exec(out)?.[1] ?? "unknown";
  const repo = /repo=(\S+)/.exec(out)?.[1] ?? null;
  if (state === "no-repo") return { active: false, state, repo: null };
  if (state === "valid") return { active: true, state, repo };
  // relink / invalid / anything else is a human decision, not an opt-out.
  throw new PrivateMountUnhealthyError(state);
}

/**
 * Every merge on the branch's own line and what it brought, newest first,
 * plus this run's merge when it fast-forwarded and left no merge commit.
 */
function branchMerges(root: string, current: Sheet["merge"]): SkipInput["merges"] {
  const merges = gitLines(root, ["log", "--merges", "--first-parent", "--format=%H", "main..HEAD"]).map((sha) => ({
    sha,
    paths: gitLines(root, ["diff", "--name-only", "--no-renames", `${sha}^1`, sha]),
    edited: gitLines(root, ["diff", "--name-only", "--no-renames", `${sha}^2`, sha]),
  }));
  const head = git(["rev-parse", "HEAD"], { cwd: root, onError: "throw" });
  if (current.status === "merged" && !merges.some((merge) => merge.sha === head)) {
    // A fast-forward: HEAD is main's commit, so it edited nothing.
    merges.unshift({ sha: head, paths: current.broughtPaths, edited: [] });
  }
  return merges;
}

/** A git command's output lines, empty ones dropped. */
function gitLines(root: string, args: string[]): string[] {
  return git(args, { cwd: root, onError: "throw" })
    .split("\n")
    .filter((line) => line !== "");
}

/** Added+deleted lines vs main, total and restricted to non-doc, non-test files. */
function diffSize(root: string): { lines: number; sourceLines: number } {
  const numstat = git(["diff", "--numstat", "main...HEAD"], { cwd: root, onError: "throw" });
  let lines = 0;
  let sourceLines = 0;
  for (const row of numstat.split("\n")) {
    if (row === "") continue;
    const [added, deleted, path] = row.split("\t");
    const count = Number(added === "-" ? 0 : added) + Number(deleted === "-" ? 0 : deleted);
    lines += count;
    if (path !== undefined && !isDocPath(path) && !isTestPath(path)) sourceLines += count;
  }
  return { lines, sourceLines };
}

/** Plans that name this workstream, plus any `Plan:` trailer on branch commits. */
function planDocs(root: string, workstream: string): string[] {
  const dir = join(root, "beebox/docs/plans");
  if (!existsSync(dir)) return [];
  const listed = git(["ls-files", "beebox/docs/plans"], { cwd: root, onError: "throw" }).split("\n");
  return listed.filter((file) => {
    if (!file.endsWith(".md")) return false;
    const head = readFileSync(join(root, file), "utf-8").slice(0, 2000);
    return head
      .split("\n")
      .some(
        (line) =>
          line.startsWith("workstream:") &&
          line.slice("workstream:".length).trim() === workstream,
      );
  });
}

export function buildSheet(input: { merge: boolean }): Sheet {
  const root = gitTopLevel();
  const branch = gitBranch(root);
  const worktree = basename(root);
  if (branch === "main" || branch === "HEAD") {
    throw new NotAWorktreeBranchError(branch);
  }
  const workstream = branch.replace(/^worktree-/, "");
  const leg = privateLeg(root);
  const stragglers = git(["status", "--porcelain"], { cwd: root, onError: "throw" })
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
  // `--no-merge` may only claim "up-to-date" when main really is contained;
  // otherwise the skip decision below would rest on a merge nobody performed.
  const mergeSkipped =
    !input.merge &&
    spawnSync("git", ["merge-base", "--is-ancestor", "main", "HEAD"], { cwd: root }).status !== 0;
  const merge: MergeResult = input.merge
    ? mergeMain(root)
    : { status: "up-to-date", broughtPaths: [], resolved: [] };

  const changed = changedPaths({ base: "main", cwd: root });
  const packages = new Set(packageOwnerDirs(root));
  const grouped = groupPaths(changed, packages);
  const skip = mergeSkipped
    ? { value: false, reason: "main was not merged in (--no-merge) and is not contained" }
    : skipTypecheckLintDecision({
        merges: branchMerges(root, merge),
        stragglers,
        ownCommits: gitLines(root, ["log", "--no-merges", "--format=", "--name-only", "--no-renames", "main..HEAD"]),
        vsMain: gitLines(root, ["diff", "--name-only", "--no-renames", "main", "HEAD"]),
      });
  // Selected BEFORE the verification list is built: a selector that failed
  // changes which test command the sheet names (the full suite, not the
  // selected set), so the two cannot disagree.
  const selectedTests = selection(root, grouped.packages);
  const verification = verificationCommands({
    paths: changed,
    workspacePackages: packages,
    hasScript: hasScriptIn(root),
    skipTypecheckLint: skip,
    selectorFailed: selectedTests?.failed === true,
  });
  const messages = git(["log", "--format=%B%x00", "main..HEAD"], { cwd: root, onError: "throw" }).split("\0");
  const trailers = parseTrailers(messages);
  const plans = planDocs(root, workstream);
  const diff = diffSize(root);
  const codeChanged = hasCodeChange(changed);

  return {
    worktree,
    branch,
    repoRoot: root,
    privateLeg: leg,
    stragglers,
    merge,
    changed: { all: changed, byGroup: grouped.groups, unknownGroups: grouped.unknown },
    docsOnly: isDocsOnly(changed),
    codeChanged,
    selectedTests,
    verification,
    skipTypecheckLint: { ...skip, rule: SKIP_RULE },
    plan: { attached: plans.length > 0 || trailers.plans.length > 0, docs: plans, trailers: trailers.plans },
    issues: trailers.issues,
    diff,
    trackO: trackORecommendation({ codeChanged, sourceLines: diff.sourceLines }),
  };
}

/** Selected files the text sheet names; `--json` has them all. */
const SHOWN_TESTS = 5;
const SHOWN_REASONS = 3;

/**
 * The text sheet. The decision fields come first (merge, verification, the
 * typecheck/lint skip), so reading only the head of the output is enough; the
 * test selection comes last as a count, its largest reasons, and a few files.
 */
export function formatSheet(sheet: Sheet): string {
  const lines: string[] = [];
  const list = (label: string, values: string[]): void => {
    lines.push(`${label}: ${values.length === 0 ? "none" : values.join(", ")}`);
  };
  lines.push(`worktree ${sheet.worktree} (${sheet.branch})`);
  const brought = sheet.merge.broughtPaths.length;
  lines.push(`merge main: ${sheet.merge.status}${brought > 0 ? ` (+${String(brought)} paths)` : ""}`);
  if (sheet.merge.resolved.length > 0) {
    list("  conflicts resolved by rule (check them in the diff review)", sheet.merge.resolved);
  }
  lines.push("verification:");
  for (const command of sheet.verification) {
    lines.push(`  ${command.skip === undefined ? "run " : "skip"} ${command.command}${command.skip === undefined ? "" : `  (${command.skip})`}`);
  }
  if (sheet.verification.length === 0) lines.push("  nothing to verify");
  lines.push(`skipTypecheckLint: ${String(sheet.skipTypecheckLint.value)} — ${sheet.skipTypecheckLint.reason}`);
  lines.push(`  rule: ${SKIP_RULE}`);
  list("stragglers (never commit these blind)", sheet.stragglers);
  lines.push(
    `private leg: ${sheet.privateLeg.active ? `ACTIVE (${sheet.privateLeg.repo ?? "?"})` : "not opted in — skip every private step"}`,
  );
  lines.push(`docsOnly: ${String(sheet.docsOnly)}   codeChanged: ${String(sheet.codeChanged)}`);
  lines.push(`changed (${String(sheet.changed.all.length)} paths):`);
  for (const [group, paths] of Object.entries(sheet.changed.byGroup)) {
    lines.push(`  ${group}: ${String(paths.length)}`);
  }
  if (sheet.changed.unknownGroups.length > 0) {
    list("  UNCLASSIFIED (verified as root)", sheet.changed.unknownGroups);
  }
  list("plan", sheet.plan.docs.length > 0 ? sheet.plan.docs : sheet.plan.trailers);
  list("issues named in trailers", sheet.issues);
  lines.push(
    `diff: ${String(sheet.diff.lines)} lines (${String(sheet.diff.sourceLines)} source)   trackO: ${sheet.trackO.recommended ? "review" : "skip"} — ${sheet.trackO.reason}`,
  );
  const tests = sheet.selectedTests;
  lines.push(`selected tests: ${tests === null ? "n/a (beebox untouched)" : tests.note}`);
  if (tests !== null && tests.files.length > 0) {
    const reasons = tests.reasons.slice(0, SHOWN_REASONS).map((group) => `${String(group.count)} ${group.reason}`);
    lines.push(`  by reason: ${reasons.join("; ")}${tests.reasons.length > SHOWN_REASONS ? "; …" : ""}`);
    for (const file of tests.files.slice(0, SHOWN_TESTS)) lines.push(`  ${file}`);
    const rest = tests.files.length - SHOWN_TESTS;
    if (rest > 0) lines.push(`  … ${String(rest)} more (--json lists all; bin/test-select.ts --why groups them)`);
  }
  return lines.join("\n");
}

const USAGE = `usage: bin/finish-preflight [--json] [--no-merge]

Merges main into this worktree branch and prints the finish decision sheet.

  --json      print the sheet as JSON
  --no-merge  re-read the sheet without merging main again
  -h, --help  print this and exit`;

/** Strict, like finish-verify: `--help` must never merge main. */
export function main(argv: string[]): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: { help: { type: "boolean", short: "h" }, json: { type: "boolean" }, "no-merge": { type: "boolean" } },
    }));
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e), USAGE);
  }
  if (values.help === true) {
    console.log(USAGE);
    return 0;
  }
  const sheet = buildSheet({ merge: values["no-merge"] !== true });
  console.log(values.json === true ? JSON.stringify(sheet, null, 2) : formatSheet(sheet));
  return 0;
}

if (process.argv[1] === import.meta.filename) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`finish-preflight: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = e instanceof PreflightError ? e.exitCode : 1;
  }
}
