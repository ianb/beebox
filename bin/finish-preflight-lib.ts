/**
 * The rules `/finish` used to re-derive in prose: what kind of change this is,
 * what has to be verified, and which judgment steps have anything to do.
 *
 * Pure — no git, no filesystem — so the shell (finish-preflight.ts) owns the
 * I/O and this stays unit-testable. The per-path verification map lived in
 * `.claude/agents/finish.md` until now; {@link verificationCommands} is the
 * one place it lives.
 *
 * See callback-box/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanisms E and E2.
 */

/** One thing finish-verify runs, with everything it needs to run it. */
export interface VerificationCommand {
  kind: "tests" | "typecheck" | "lint";
  /** What the agent would type; also the display name in finish-verify output. */
  command: string;
  /** Repo-root-relative directory to run in. */
  cwd: string;
  argv: string[];
  /**
   * Argv prefix for the isolated re-run of one failing test file, if possible.
   *
   * `cwd` is where the re-run is spawned; `packageDir` is the directory the
   * suite's OWN paths are relative to, which is not the same thing. `pnpm
   * --dir callback-box` is spawned from the repo root while tap names
   * `test/foo.test.ts` relative to `callback-box/` — resolving a TAP path
   * against `cwd` alone finds nothing, and a failing file that cannot be
   * identified is reported as real rather than re-run.
   */
  isolate?: { cwd: string; packageDir: string; argv: string[] };
  /** Present when the command is named but deliberately not run. */
  skip?: string;
}

/** Top-level directories whose changes are covered by the ROOT scripts. */
const ROOT_DIRS = new Set(["bin", "dev", "schedules", "patches", "security"]);

/** Top-level directories with no build/test tooling of their own. */
const NONE_DIRS = new Set([
  ".claude",
  ".github",
  ".husky",
  "comments",
  "docs",
  "exhibits",
  "feedback-review",
  "ios-app",
  "issues",
  "notes",
  "private-issues",
  "research",
  "scratch",
  "workstream-exhibits",
]);

/** Root files that change what the root scripts check. */
const ROOT_FILES = new Set([
  "eslint.config.mjs",
  "knip.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
]);

export type PathGroup =
  | { kind: "package"; name: string }
  | { kind: "root" }
  | { kind: "none" }
  | { kind: "unknown"; name: string };

/**
 * Which verification surface owns a path. `workspacePackages` is the top-level
 * directory of every pnpm workspace entry, so a new package is classified
 * without editing this file.
 */
export function groupOf(path: string, workspacePackages: Set<string>): PathGroup {
  const [head, ...rest] = path.split("/");
  if (head === undefined || head === "") return { kind: "none" };
  if (rest.length === 0) {
    if (ROOT_FILES.has(head)) return { kind: "root" };
    return { kind: "none" };
  }
  if (workspacePackages.has(head)) return { kind: "package", name: head };
  if (ROOT_DIRS.has(head)) return { kind: "root" };
  if (NONE_DIRS.has(head)) return { kind: "none" };
  // Fail toward more verification, and say so: an unclassified directory is a
  // gap in this map, not a licence to skip checks.
  return { kind: "unknown", name: head };
}

/** Changed paths keyed by the group that verifies them, for the sheet's report. */
export function groupPaths(
  paths: string[],
  workspacePackages: Set<string>,
): { groups: Record<string, string[]>; packages: string[]; root: boolean; unknown: string[] } {
  const groups: Record<string, string[]> = {};
  const packages = new Set<string>();
  const unknown = new Set<string>();
  let root = false;
  for (const path of paths) {
    const group = groupOf(path, workspacePackages);
    const key =
      group.kind === "package" || group.kind === "unknown" ? group.name : `(${group.kind})`;
    (groups[key] ??= []).push(path);
    if (group.kind === "package") packages.add(group.name);
    if (group.kind === "root") root = true;
    if (group.kind === "unknown") {
      unknown.add(group.name);
      root = true;
    }
  }
  return {
    groups,
    packages: [...packages].sort(),
    root,
    unknown: [...unknown].sort(),
  };
}

/** A `.doctest.md` is executable behaviour, never prose. */
export function isDoctest(path: string): boolean {
  return path.endsWith(".doctest.md");
}

export function isDocPath(path: string): boolean {
  return path.endsWith(".md") && !isDoctest(path);
}

export function isTestPath(path: string): boolean {
  return isDoctest(path) || /\.test\.tsx?$/.test(path) || /(^|\/)test\//.test(path);
}

/**
 * The docs-only rule, verbatim from the procedure it replaces: every changed
 * path sits under a `docs/` directory AND none is a `.doctest.md`.
 */
export function isDocsOnly(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((path) => path.split("/").includes("docs") && !isDoctest(path));
}

/** Any non-test, non-doc source in the diff — what Track O and lint exist for. */
export function hasCodeChange(paths: string[]): boolean {
  return paths.some((path) => !isDocPath(path) && !isTestPath(path));
}

export interface CommandInput {
  paths: string[];
  workspacePackages: Set<string>;
  /** Does `<pkg>`'s package.json define this script? */
  hasScript: (pkg: string, script: string) => boolean;
  /** From {@link skipTypecheckLintDecision}. */
  skipTypecheckLint: { value: boolean; reason: string };
  /** Did `bin/test-select` fail outright? Then callback-box runs everything. */
  selectorFailed?: boolean;
}

/**
 * callback-box iterates on the selected set; every other package runs its own.
 *
 * When the selector itself failed — a graph or esbuild error, not a test
 * failure — there is no selection to iterate on, and `test:changed` would just
 * hit the same error. The plan's rule for an internal selector error is that
 * callers run the full suite, so that is what the sheet names.
 */
function testScript(pkg: string, selectorFailed: boolean): string {
  return pkg === "callback-box" && !selectorFailed ? "test:changed" : "test";
}

/**
 * The isolated re-run of one failing test file. Only callback-box and the root
 * suite have one that keeps the ledger's flake derivation working (a
 * fail-then-pass at the same content hash IS the flake definition); elsewhere
 * finish-verify reports the failure as real without a re-run.
 */
const ROOT_ISOLATE = { cwd: ".", packageDir: ".", argv: ["node", "--import", "tsx", "--test"] };

function isolateFor(pkg: string): VerificationCommand["isolate"] | undefined {
  if (pkg === "callback-box") {
    return {
      cwd: ".",
      packageDir: "callback-box",
      argv: [
        "pnpm",
        "--dir",
        "callback-box",
        "exec",
        "node",
        "--import",
        "tsx",
        "../bin/test-ledger.ts",
        "run",
        "--mode",
        "selected",
        "--",
        "tap",
      ],
    };
  }
  return undefined;
}

/**
 * The commands this diff calls for, coalesced.
 *
 * Lint is one entry however many packages changed: root `pnpm lint:changed`
 * IS the fan-out — it dispatches per changed package and adds `bin/schedules
 * lint` for a `schedules/` change, which no per-package lint covers. `bin/` and
 * `dev/` carry no ESLint rules of their own, so a change confined to them
 * still lints nothing. Tests and typechecks stay per-package — root `pnpm
 * typecheck` is root-only and replaces no package's.
 *
 * Lint here means CHANGED-file lint, the same "run what the change implicates"
 * posture the test selection already takes. The cross-file consequence a
 * whole-tree run would catch is an accepted escape, exactly like an
 * unimplicated test —
 * issues/closed/code-quality/2026-08-25-lint-runs-contend-like-tests.md.
 * Typecheck stays whole-tree (it is incremental now, and cheap warm).
 */
export function verificationCommands(input: CommandInput): VerificationCommand[] {
  const { packages, root } = groupPaths(input.paths, input.workspacePackages);
  const docsOnly = isDocsOnly(input.paths);
  const commands: VerificationCommand[] = [];
  const skipTypeLint = docsOnly
    ? "docs-only diff"
    : input.skipTypecheckLint.value
      ? input.skipTypecheckLint.reason
      : undefined;

  const add = (command: VerificationCommand): void => {
    const skip = docsOnly && command.kind === "tests" ? "docs-only diff" : undefined;
    const reason = command.kind === "tests" ? skip : skipTypeLint;
    commands.push(reason === undefined ? command : { ...command, skip: reason });
  };

  for (const pkg of packages) {
    const script = testScript(pkg, input.selectorFailed === true);
    if (input.hasScript(pkg, script)) {
      const isolate = isolateFor(pkg);
      add({
        kind: "tests",
        command: `pnpm --dir ${pkg} ${script}`,
        cwd: ".",
        argv: ["pnpm", "--dir", pkg, script],
        ...(isolate === undefined ? {} : { isolate }),
      });
    }
    if (input.hasScript(pkg, "typecheck")) {
      add({
        kind: "typecheck",
        command: `pnpm --dir ${pkg} typecheck`,
        cwd: ".",
        argv: ["pnpm", "--dir", pkg, "typecheck"],
      });
    }
  }

  if (root) {
    add({
      kind: "tests",
      command: "pnpm test",
      cwd: ".",
      argv: ["pnpm", "test"],
      isolate: ROOT_ISOLATE,
    });
    add({ kind: "typecheck", command: "pnpm typecheck", cwd: ".", argv: ["pnpm", "typecheck"] });
  }

  const linting = packages.filter((pkg) => input.hasScript(pkg, "lint"));
  const schedules = input.paths.some((path) => path.startsWith("schedules/"));
  if (linting.length > 0 || schedules) {
    add({ kind: "lint", command: "pnpm lint:changed", cwd: ".", argv: ["pnpm", "lint:changed"] });
  }
  return commands;
}

export interface SkipInput {
  /** Did `git merge main` change this branch's HEAD? */
  mergeNoOp: boolean;
  /** Paths the merge brought in (empty when it was a no-op). */
  mergeBroughtPaths: string[];
  /** Uncommitted paths — never verified by any earlier commit's pre-commit. */
  stragglers: string[];
}

/**
 * Whether typecheck and lint can be skipped.
 *
 * `--no-verify` leaves no evidence in git, so it cannot be detected; the rule
 * is the one that holds without it. Pre-commit runs typecheck and lint on
 * every worktree commit, so the branch's own commits are already covered — a
 * finish needs them again only when something arrived that pre-commit never
 * saw: code from the merge of main, or an uncommitted straggler.
 */
export function skipTypecheckLintDecision(input: SkipInput): { value: boolean; reason: string } {
  if (input.stragglers.length > 0) {
    return { value: false, reason: `uncommitted paths never ran pre-commit` };
  }
  if (input.mergeNoOp) {
    return { value: true, reason: "merge of main was a no-op; pre-commit covered every commit" };
  }
  if (!hasCodeChange(input.mergeBroughtPaths)) {
    return { value: true, reason: "merge of main brought no code; pre-commit covered every commit" };
  }
  return { value: false, reason: "the merge of main brought code in" };
}

/** Below this many changed source lines a diff review finds nothing lint didn't. */
const TRACK_O_MIN_LINES = 30;

export function trackORecommendation(input: { codeChanged: boolean; sourceLines: number }): {
  recommended: boolean;
  reason: string;
} {
  if (!input.codeChanged) return { recommended: false, reason: "no non-test, non-doc source" };
  if (input.sourceLines < TRACK_O_MIN_LINES) {
    return { recommended: false, reason: `${input.sourceLines} source lines (< ${TRACK_O_MIN_LINES})` };
  }
  return { recommended: true, reason: `${input.sourceLines} source lines changed` };
}

/**
 * `Issue:` and `Plan:` trailers across the branch's commits. Hooks stamp
 * `Plan:`; `Issue:` is written by hand (monorepo CLAUDE.md, commit provenance).
 */
export function parseTrailers(messages: string[]): { issues: string[]; plans: string[] } {
  const issues = new Set<string>();
  const plans = new Set<string>();
  for (const message of messages) {
    for (const line of message.split("\n")) {
      const match = /^(Issue|Plan):\s*(\S+)\s*$/.exec(line.trim());
      if (match === null) continue;
      const [, key, value] = match;
      (key === "Issue" ? issues : plans).add(value ?? "");
    }
  }
  return { issues: [...issues].sort(), plans: [...plans].sort() };
}
