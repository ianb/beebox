/**
 * `bin/finish-preflight --tested <rev>`: the paths changed since a revision
 * whose checks passed, and which of the sheet's checks they reach. The finish
 * agent decides whether a pass still holds; this only reports, and skips
 * nothing (issues/closed/features/2026-11-13-finish-preflight-reports-delta-since-tested-revision.md,
 * plan:finish-preflight-tested-delta).
 *
 * Reach comes from the maps the sheet already uses: each path goes through
 * {@link verificationCommands} alone, and beebox tests through the test
 * selector run against the tested revision. A shared input (a root config
 * file, a pnpm patch, an unclassified directory) can change any check's
 * result without the map naming it, so it reaches every check.
 */

import { spawnSync } from "node:child_process";
import { gitOrNull } from "./lib/git.js";
import { changedPaths } from "./test-git.js";
import { TestedRevisionError } from "./finish-preflight-errors.js";
import { groupOf, ROOT_FILES, verificationCommands, type VerificationCommand } from "./finish-preflight-lib.js";
import { selection } from "./finish-preflight-select.js";

export interface DeltaCheck {
  /** The sheet's command, as finish-verify names it. */
  command: string;
  reached: boolean;
  /** The test selector's answer, for beebox tests. */
  note?: string;
}

/** Paths that reach the same set of checks. */
export interface DeltaGroup {
  checks: string[];
  shared: boolean;
  paths: string[];
}

export interface SinceTested {
  rev: string;
  sha: string;
  paths: string[];
  checks: DeltaCheck[];
  groups: DeltaGroup[];
  /** beebox tests the delta selects, when the sheet runs beebox tests. */
  selectedTests: string[] | null;
}

export interface DeltaInput {
  /** Paths changed since the tested revision, uncommitted ones included. */
  paths: string[];
  /** The sheet's verification list. */
  verification: VerificationCommand[];
  workspacePackages: Set<string>;
  hasScript: (pkg: string, script: string) => boolean;
  /** The sheet's selector failed, so its beebox test command is `test`: names must match. */
  selectorFailed: boolean;
  /** The selector run on the delta; null when the sheet runs no beebox tests. */
  deltaTests: { count: number; failed: boolean; note: string; causes: string[] } | null;
}

/** Apple's command carries its paths, so Apple checks match by kind. */
const checkKey = (command: VerificationCommand): string => (command.kind === "apple" ? "apple" : command.command);

const isBeeboxTests = (command: VerificationCommand): boolean =>
  command.kind === "tests" && command.isolate?.packageDir === "beebox";

function isSharedInput(path: string, workspacePackages: Set<string>): boolean {
  const group = groupOf(path, workspacePackages);
  if (group.kind === "unknown") return true;
  return group.kind === "root" && (ROOT_FILES.has(path) || path.startsWith("patches/"));
}

/**
 * A path that is the check's own runner, or a sibling module of it
 * (`bin/smoke`, `bin/smoke-lib.ts`): the map sends these to the root suite,
 * but they change the check itself.
 */
function isRunnerOf(path: string, command: VerificationCommand): boolean {
  const runner = command.argv[0] ?? "";
  if (!runner.startsWith("bin/")) return false;
  return path === runner || path.startsWith(`${runner}-`) || path.startsWith(`${runner}.`);
}

/**
 * Which of the sheet's run (not skipped) checks the delta reaches, and through
 * which paths. beebox tests follow the selector when it ran: a path reaches
 * them when a selection reason names it.
 */
export function deltaSinceTested(input: DeltaInput): { checks: DeltaCheck[]; groups: DeltaGroup[] } {
  const listed = input.verification.filter((command) => command.skip === undefined);
  const selector = input.deltaTests !== null && !input.deltaTests.failed ? input.deltaTests : null;
  const causes = new Set(selector?.causes);
  const groups = new Map<string, DeltaGroup>();
  const reached = new Set<string>();
  for (const path of input.paths) {
    const shared = isSharedInput(path, input.workspacePackages);
    const keys = verificationCommands({
      paths: [path],
      workspacePackages: input.workspacePackages,
      hasScript: input.hasScript,
      skipTypecheckLint: { value: false, reason: "" },
      selectorFailed: input.selectorFailed,
    })
      .filter((command) => command.skip === undefined)
      .map(checkKey);
    const reaches = (command: VerificationCommand): boolean => {
      if (shared || isRunnerOf(path, command)) return true;
      if (isBeeboxTests(command) && selector !== null) return causes.has(path);
      return keys.includes(checkKey(command));
    };
    const checks = listed.filter(reaches).map((command) => command.command);
    for (const command of checks) reached.add(command);
    const key = `${String(shared)}\0${checks.join("\0")}`;
    const group = groups.get(key) ?? { checks, shared, paths: [] };
    group.paths.push(path);
    groups.set(key, group);
  }
  const checks = listed.map((command): DeltaCheck => {
    const byPath = reached.has(command.command);
    if (!isBeeboxTests(command) || input.deltaTests === null) return { command: command.command, reached: byPath };
    if (input.deltaTests.failed) return { command: command.command, reached: true, note: input.deltaTests.note };
    const { count } = input.deltaTests;
    if (count === 0) return { command: command.command, reached: byPath, note: "no test imports these paths" };
    // Tests the graph cannot resolve run on any change and name no path.
    const note = `${String(count)} tests selected${byPath ? "" : ", none through a single path"}`;
    return { command: command.command, reached: true, note };
  });
  return { checks, groups: [...groups.values()] };
}

/** Resolved before the merge, so `HEAD` names the tip the caller tested. */
export function resolveTested(root: string, rev: string): string {
  const sha = gitOrNull(["rev-parse", "--verify", "-q", `${rev}^{commit}`], {
    cwd: root,
  });
  if (sha === null) throw new TestedRevisionError({ rev, sha: null });
  return sha;
}

export function sinceTested(input: {
  root: string;
  rev: string;
  sha: string;
  packages: Set<string>;
  hasScript: (pkg: string, script: string) => boolean;
  verification: VerificationCommand[];
  selectorFailed: boolean;
}): SinceTested {
  const { root, rev, sha } = input;
  // changedPaths diffs `<sha>...HEAD`, from the merge base: for a commit HEAD
  // does not contain, that hides changes. Refuse rather than under-report.
  if (
    spawnSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
      cwd: root,
    }).status !== 0
  ) {
    throw new TestedRevisionError({ rev, sha });
  }
  const paths = changedPaths({ base: sha, cwd: root });
  const runsBeeboxTests = input.verification.some((command) => command.skip === undefined && isBeeboxTests(command));
  const tests = runsBeeboxTests && paths.length > 0 ? selection({ root, base: sha }) : null;
  const delta = deltaSinceTested({
    paths,
    verification: input.verification,
    workspacePackages: input.packages,
    hasScript: input.hasScript,
    selectorFailed: input.selectorFailed,
    deltaTests:
      tests === null
        ? null
        : {
            count: tests.files.length,
            failed: tests.failed === true,
            note: tests.note,
            causes: tests.causes,
          },
  });
  return { rev, sha, paths, ...delta, selectedTests: tests?.files ?? null };
}

/** Every path, once, under the checks it reaches. */
export function formatSinceTested(delta: SinceTested): string[] {
  const lines = [
    `since tested ${delta.sha.slice(0, 9)}: ${String(delta.paths.length)} paths (whether a pass still holds is your call)`,
  ];
  for (const check of delta.checks) {
    const note = check.note === undefined ? "" : `  (${check.note})`;
    lines.push(`  ${check.reached ? "reached    " : "not reached"} ${check.command}${note}`);
  }
  for (const group of delta.groups) {
    const label = group.shared
      ? "shared input, reaches every check"
      : group.checks.length === 0
        ? "reaches no listed check"
        : `reaches ${group.checks.join(", ")}`;
    lines.push(`  ${label}:`);
    for (const path of group.paths) lines.push(`    ${path}`);
  }
  return lines;
}
