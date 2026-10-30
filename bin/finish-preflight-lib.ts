/**
 * The rules `/finish` used to re-derive in prose: what kind of change this is,
 * what has to be verified, and which judgment steps have anything to do.
 *
 * Pure — no git, no filesystem — so the shell (finish-preflight.ts) owns the
 * I/O and this stays unit-testable. The per-path verification map lived in
 * `.claude/agents/finish.md` until now; {@link verificationCommands} is the
 * one place it lives.
 *
 * See beebox/docs/plans/change-based-test-selection.md, "Revision
 * 2026-08-25 — test economics", mechanisms E and E2.
 */

import { touchesDeployedPath } from "./deployed-paths.js";

/** One thing finish-verify runs, with everything it needs to run it. */
export interface VerificationCommand {
  kind: "tests" | "typecheck" | "lint" | "smoke" | "site" | "apple" | "theme";
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
   * --dir beebox` is spawned from the repo root while tap names
   * `test/foo.test.ts` relative to `beebox/` — resolving a TAP path
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
  "issues",
  "notes",
  "private-issues",
  "research",
  "scratch",
  "workstream-exhibits",
]);

/** Top-level directories checked together by bin/apple-test. */
const APPLE_DIRS = new Set(["apple-shared", "ios-app", "mac-app"]);

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
  | { kind: "apple" }
  | { kind: "unknown"; name: string };

/**
 * Which verification surface owns a path. `workspacePackages` is the directory
 * of every pnpm workspace package (bin/workspace-packages.ts), so a new package
 * is classified without editing this file.
 *
 * The NEAREST enclosing package wins: `beebox/pub-worker` is its own
 * package inside beebox, and its `test`/`typecheck`/`lint` are the ones
 * that cover a change under it.
 */
export function groupOf(path: string, workspacePackages: Set<string>): PathGroup {
  const segments = path.split("/");
  const [head, ...rest] = segments;
  if (head === undefined || head === "") return { kind: "none" };
  if (rest.length === 0) {
    if (ROOT_FILES.has(head)) return { kind: "root" };
    return { kind: "none" };
  }
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const dir = segments.slice(0, depth).join("/");
    if (workspacePackages.has(dir)) return { kind: "package", name: dir };
  }
  if (ROOT_DIRS.has(head)) return { kind: "root" };
  if (APPLE_DIRS.has(head)) return { kind: "apple" };
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
    packages: [...packages].toSorted(),
    root,
    unknown: [...unknown].toSorted(),
  };
}

export function isDocPath(path: string): boolean {
  return path.endsWith(".md");
}

export function isTestPath(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || /(^|\/)test\//.test(path);
}

/**
 * The docs-only rule: every changed path is either a `.md` anywhere (an
 * issue note, README, CONTRIBUTING, a plan) or sits under a `docs/`
 * directory (which admits images and other doc assets). Broadened 2026-09-12 from "under docs/ only": the
 * checkpoint note finish appends under `issues/` was flipping every
 * docs-only landing into the full test tier plus the smoke walk. This
 * matches `hasCodeChange`, which already treats any `.md` as a doc.
 */
export function isDocsOnly(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((path) => isDocPath(path) || path.split("/").includes("docs"));
}

/** Anything the public site build reads: site/ itself, or any markdown (the docs manifest promotes repo docs). */
export function touchesSiteInput(paths: string[]): boolean {
  return paths.some((path) => path.startsWith("site/") || isDocPath(path));
}

/**
 * Theme styles, the primitives and palette that pick ink and surfaces, the
 * studio that stages them, the theme catalog, and the contrast checker: what
 * `bin/theme-check --all` measures or runs.
 */
export function touchesThemeSurface(paths: string[]): boolean {
  const prefixes = [
    "beebox/src/frontend/src/themes/",
    "beebox/src/frontend/src/components/themes/",
    // The primitives that choose ink and surface, and the palette.
    "beebox/src/frontend/src/components/ui/",
    "beebox/src/frontend/tailwind.config.js",
    "beebox/src/frontend/src/pages/dev/theme-studio",
    "beebox/src/frontend/src/pages/dev/ThemeStudioPage.tsx",
    "beebox/src/frontend/src/pages/dev/components/ThemeStudio",
    "beebox/src/shared/card-theme/",
    "beebox/src/shared/theme-screens.ts",
    "beebox/src/shared/theme-studio-case.ts",
    "beebox/test/tours/theme-check.ts",
    "beebox/test/tours/tour-lib/contrast",
    "beebox/test/tours/tour-lib/backdrop",
    "beebox/test/tours/tour-lib/rules",
    "bin/theme-check",
  ];
  return paths.some((path) => prefixes.some((prefix) => path.startsWith(prefix)));
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
  /** Did `bin/test-select` fail outright? Then beebox runs everything. */
  selectorFailed?: boolean;
}

/**
 * beebox iterates on the selected set; every other package runs its own.
 *
 * When the selector itself failed — a graph or esbuild error, not a test
 * failure — there is no selection to iterate on, and `test:changed` would just
 * hit the same error. The plan's rule for an internal selector error is that
 * callers run the full suite, so that is what the sheet names.
 */
function testScript(pkg: string, selectorFailed: boolean): string {
  return pkg === "beebox" && !selectorFailed ? "test:changed" : "test";
}

/**
 * The isolated re-run of one failing test file. Only beebox and the root
 * suite have one that keeps the ledger's flake derivation working (a
 * fail-then-pass at the same content hash IS the flake definition); elsewhere
 * finish-verify reports the failure as real without a re-run.
 */
const ROOT_ISOLATE = { cwd: ".", packageDir: ".", argv: ["node", "--import", "tsx", "--test"] };

function isolateFor(pkg: string): VerificationCommand["isolate"] | undefined {
  if (pkg === "beebox") {
    return {
      cwd: ".",
      packageDir: "beebox",
      argv: [
        "pnpm",
        "--dir",
        "beebox",
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
  const { packages, root, groups } = groupPaths(input.paths, input.workspacePackages);
  const docsOnly = isDocsOnly(input.paths);
  const commands: VerificationCommand[] = [];
  const skipTypeLint = docsOnly
    ? "docs-only diff"
    : input.skipTypecheckLint.value
      ? input.skipTypecheckLint.reason
      : undefined;

  const add = (command: VerificationCommand): void => {
    // Tests and the smoke walk answer for behaviour, so only a docs-only diff
    // excuses them; typecheck and lint additionally skip on the
    // nothing-changed-since-verified rule.
    const behavioural =
      command.kind === "tests" || command.kind === "smoke" || command.kind === "apple" || command.kind === "theme";
    const skip = docsOnly ? "docs-only diff" : undefined;
    const reason = behavioural ? skip : skipTypeLint;
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

  // Apple code: one check for ios-app/, mac-app/ and apple-shared/. The argv
  // carries the changed paths so bin/apple-test picks its steps (the iOS
  // simulator run only for ios-app/ or apple-shared/). A prose .md among them
  // is no reason to run tests. With only docs under the Apple dirs there is no
  // check, except in an all-docs diff, where add() lists it as skipped.
  const applePaths = groups["(apple)"] ?? [];
  const appleCodePaths = applePaths.filter((path) => !isDocPath(path));
  if (appleCodePaths.length > 0 || (docsOnly && applePaths.length > 0)) {
    const argvPaths = appleCodePaths.length > 0 ? appleCodePaths : applePaths;
    add({
      kind: "apple",
      command: `bin/apple-test --changed ${argvPaths.join(" ")}`,
      cwd: ".",
      argv: ["bin/apple-test", "--changed", ...argvPaths],
    });
  }

  // The smoke tier: a code-related landing boots a real box and walks it
  // before it merges. "Code-related" is the deploy hook's own rule — what
  // ships is what owes an answer here (bin/deployed-paths.ts). Docs-only
  // diffs never reach it, and a diff that touches only bin/, issues/ or
  // ios-app/ changes nothing a running box would show.
  if (touchesDeployedPath(input.paths)) {
    add({ kind: "smoke", command: "bin/smoke", cwd: ".", argv: ["bin/smoke"] });
  }

  // Every catalog theme in the studio, measured for contrast. Needs the dev
  // router, like the tours it shares its audit with.
  if (touchesThemeSurface(input.paths)) {
    add({ kind: "theme", command: "bin/theme-check --all", cwd: ".", argv: ["bin/theme-check", "--all"] });
  }

  // The public site's canonical build: what Cloudflare runs on every push of
  // main. It consumes site/ AND every markdown the docs manifest promotes
  // (README, CONTRIBUTING, beebox/docs, the engine's AGENTS.md), and it fails
  // closed on a scrub-gate hit or a broken link. It is the one check a
  // docs-only diff must NOT skip: docs are exactly its input. Without it a
  // merge that breaks the site build is silent until someone looks at
  // beebox.run (2026-09-12: six merges shipped nothing for two hours).
  if (touchesSiteInput(input.paths)) {
    commands.push({
      kind: "site",
      command: "pnpm --dir site build --base /",
      cwd: ".",
      argv: ["pnpm", "--dir", "site", "build", "--base", "/"],
    });
  }

  const linting = packages.filter((pkg) => input.hasScript(pkg, "lint"));
  const schedules = input.paths.some((path) => path.startsWith("schedules/"));
  if (linting.length > 0 || schedules) {
    add({ kind: "lint", command: "pnpm lint:changed", cwd: ".", argv: ["pnpm", "lint:changed"] });
  }
  return commands;
}

export interface SkipInput {
  /**
   * Every merge on the branch's first-parent line (`main..HEAD`), with the
   * paths each brought onto the branch — this run's merge and every earlier
   * one. A fast-forward has no merge commit; the shell lists it here too.
   * `edited` is where the merge's result differs from the side it merged in
   * (`git diff M^2 M`): the branch's own content plus any conflict resolution
   * or evil-merge edit. A fast-forward edits nothing.
   */
  merges: { sha: string; paths: string[]; edited: string[] }[];
  /** Uncommitted paths — never verified by any earlier commit's pre-commit. */
  stragglers: string[];
  /** Paths any non-merge commit in `main..HEAD` touched, even if a later commit reverted it. */
  ownCommits: string[];
  /** Paths where HEAD's committed tree differs from main's (`git diff main HEAD`, main merged in). */
  vsMain: string[];
}

/**
 * Whether typecheck and lint can be skipped.
 *
 * `--no-verify` leaves no evidence in git, so it cannot be detected; the rule
 * is the one that holds without it. Pre-commit runs typecheck and lint on
 * every worktree commit, so the branch's own commits are already covered — a
 * finish needs them again only when something arrived that pre-commit never
 * saw: a non-`.md` path from a merge (tests included: they are typechecked),
 * or an uncommitted straggler.
 *
 * Every merge counts, not just this run's. A first preflight run that merged
 * code from main and then stopped leaves a merge commit that a clean merge's
 * missing pre-commit never checked; the second run's own merge is a no-op, and
 * asking only about it skipped both checks
 * (issues/closed/bugs/2026-10-10-finish-preflight-rerun-skips-typecheck-after-merge-brought-code.md).
 * No later commit counts as evidence that the merged tree was checked:
 * pre-commit skips docs-only commits, and on any commit (a conflicted merge's
 * included) it typechecks only the packages that commit stages.
 *
 * A merge's code goes unchecked only when it meets code of the branch's own.
 * When the branch's own commits, every merge's edits, and HEAD's diff against
 * main all touch only `.md` files, the merged code is main's code, which
 * main's own landings checked. A non-`.md` path in any of the three (a branch
 * commit, even one later reverted; a conflict resolved in code; an evil merge)
 * still forces both checks.
 */
export function skipTypecheckLintDecision(input: SkipInput): { value: boolean; reason: string } {
  if (input.stragglers.length > 0) {
    return { value: false, reason: "uncommitted paths never ran pre-commit" };
  }
  const codeMerge = input.merges.find((merge) => merge.paths.some((path) => !isDocPath(path)));
  if (codeMerge === undefined) {
    if (input.merges.length === 0) {
      return { value: true, reason: "no merge on this branch; pre-commit covered every commit" };
    }
    return { value: true, reason: "no merge on this branch brought code; pre-commit covered every commit" };
  }
  const merge = `merge ${codeMerge.sha.slice(0, 9)}`;
  const code = (paths: string[]): string[] => paths.filter((path) => !isDocPath(path));
  const evidence: [string, string[]][] = [
    ["a branch commit touched code", code(input.ownCommits)],
    ...input.merges.map((m): [string, string[]] => [`merge ${m.sha.slice(0, 9)} edited code`, code(m.edited)]),
    ["HEAD differs from main in code", code(input.vsMain)],
  ];
  const forced = evidence.find(([, paths]) => paths.length > 0);
  if (forced === undefined) {
    return {
      value: true,
      reason: `${merge} brought code, but the branch changed only .md files; main's landings checked that code`,
    };
  }
  const [what, paths] = forced;
  const more = paths.length > 1 ? ` +${String(paths.length - 1)}` : "";
  return {
    value: false,
    reason: `${merge} brought code in and ${what} (${paths[0] ?? ""}${more}); no hook typechecked the merged tree`,
  };
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
 * `Plan:`; `Issue:` is written by hand (monorepo AGENTS.md, commit provenance).
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
  return { issues: [...issues].toSorted(), plans: [...plans].toSorted() };
}
