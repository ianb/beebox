#!/usr/bin/env tsx

/**
 * `box-packageify` — convert a legacy (shapeVersion 1) box in place into the
 * v2 package layout described in "The box repository"
 * (`docs/plans/boxes-as-packages-v2.md`, Track H).
 *
 * Legacy shape (box root == package root):
 *   <box>/.cb-box, CLAUDE.md, box/, config/, config/schemas/*.ts, views/*.tsx,
 *   tricks/, .claude/, ...
 *
 * v2 shape (same top-level directory, now the PACKAGE root):
 *   <box>/package.json, tsconfig.json, CLAUDE.md (thin), .gitignore, .claude/
 *   <box>/src/{schemas,views,tricks}/        -- code, extracted
 *   <box>/content/                           -- the operational root (moved)
 *     .cb-box (shapeVersion: 2), CLAUDE.md (original), box/, config/, ...
 *
 * The top-level directory path never changes — only what lives inside it.
 * `.git` and `.claude/` stay exactly where they are (the git root and the
 * Claude Code project root both move UP to the package root, which is this
 * same directory); everything else either becomes code (`src/`) or
 * operational data (`content/`).
 *
 * ## Why this migration self-commits (the one deliberate exception)
 *
 * `docs/migrations.md` — and `cb migrate` itself — never auto-commit a
 * migration's changes; the boxholder reviews and commits. That convention
 * assumes a partially-applied migration is still a *usable* box. It is not
 * true here: a box caught mid-conversion is neither a valid legacy box (its
 * `.cb-box` may already be gone) nor a valid v2 box (schemas/views may be
 * half-moved) — no engine build can serve it. So this script performs ONE
 * commit of the entire conversion at the end, wrapped in a snapshot + revert
 * (`revertToSnapshot`, factored out of `cb upgrade`'s revert path in
 * `src/cli/lib/git.ts`) so ANY failure at ANY step restores the box to a
 * byte-identical pre-migration state — never a half-converted one.
 *
 * The migration *manifest* entry (`config/migrations.jsonl`) is NOT written
 * by this script — same as every other migrator (see docs/migrations.md's
 * "Manual runs" section), that bookkeeping is `cb migrate`'s job, appended
 * after this script returns 0. Because this script moves `config/` itself
 * (to `content/config/`), `cb migrate`'s own loop re-resolves the box's
 * current location before appending that entry — see the comment on the
 * `boxRoot` reassignment in `src/cli/commands/migrate.ts`.
 *
 * Usage:
 *   pnpm exec tsx scripts/migrate/box-packageify.ts <boxRoot>          # dry-run
 *   pnpm exec tsx scripts/migrate/box-packageify.ts <boxRoot> --apply
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { getStatus, isRepo, hasCommits, getHead, revertToSnapshot, stageAll, commit } from "../../src/cli/lib/git.js";
import { detectBoxTarget, scaffoldPackageRoot, BoxPackageConflictError } from "../../src/core/box-package.js";
import { runInit } from "../../src/cli/commands/init.js";
import { encodeProjectDir, claudeProjectsRoot } from "../../src/cli/lib/session.js";

export class NotABoxError extends Error {
  constructor(boxRoot: string) {
    super(`${boxRoot} isn't a callback box (no .cb-box marker there or at ${boxRoot}/content) -- nothing for box-packageify to convert.`);
    this.name = "NotABoxError";
  }
}

export class NotAGitRepoError extends Error {
  constructor(boxRoot: string) {
    super(`${boxRoot} is not a git repository -- box-packageify requires the box to already be one.`);
    this.name = "NotAGitRepoError";
  }
}

export class NoCommitsError extends Error {
  constructor(boxRoot: string) {
    super(`${boxRoot} has no commits yet -- box-packageify needs a HEAD to snapshot for revert-on-failure.`);
    this.name = "NoCommitsError";
  }
}

export class DirtyTreeError extends Error {
  constructor(boxRoot: string) {
    super(`${boxRoot} has uncommitted changes -- commit or stash them before box-packageify (it needs a clean starting point to snapshot and safely revert).`);
    this.name = "DirtyTreeError";
  }
}

/** Already-applied, idempotent no-op (shape is already 2+). */
export interface AlreadyMigratedResult {
  status: "already-migrated";
}

export interface AppliedResult {
  status: "applied";
  packageRoot: string;
  contentRoot: string;
  commitHash: string;
}

export type BoxPackageifyResult = AlreadyMigratedResult | AppliedResult;

/** The three code-bearing subtrees that move to `src/<name>/`, and where each is found in the legacy layout. */
const CODE_DIR_MOVES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "views", to: "src/views" },
  { from: "config/schemas", to: "src/schemas" },
  { from: "tricks", to: "src/tricks" },
];

/** Top-level entries that stay exactly where they are (become part of the package root, not content/). */
const STAYS_AT_PACKAGE_ROOT = new Set([".git", ".claude"]);

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (_e) {
    return false;
  }
}

/** Move `from` to `to`, creating `to`'s parent directory first. No-op (returns false) if `from` doesn't exist. */
async function moveIfPresent(from: string, to: string): Promise<boolean> {
  if (!(await pathExists(from))) return false;
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
  return true;
}

/**
 * Extract the three code-bearing subtrees into `src/`. `config/schemas/`
 * carries its own stub `package.json` (superseded by the v2 package.json at
 * the repo root) -- dropped, not moved. `tricks/`'s own `package.json`
 * (agent-installed trick dependencies) moves WITH it; nothing else in the
 * plan's code-dir list gets special-cased.
 */
async function extractCodeDirs(boxRoot: string): Promise<string[]> {
  const moved: string[] = [];
  for (const { from, to } of CODE_DIR_MOVES) {
    const fromAbs = path.join(boxRoot, from);
    if (from === "config/schemas") {
      const stubPkg = path.join(fromAbs, "package.json");
      if (await pathExists(stubPkg)) await fs.rm(stubPkg);
    }
    if (await moveIfPresent(fromAbs, path.join(boxRoot, to))) moved.push(from);
  }
  return moved;
}

/**
 * Move everything else at the top level into `content/`. Deliberately
 * generic (move every remaining top-level entry) rather than an enumerated
 * allowlist: a real box accumulates ad hoc top-level files over years
 * (scratch notes, a docs index, etc.) that no fixed list anticipates, and
 * any of them left behind at the package root would be silently invisible
 * to the operating agent (whose cwd becomes `content/`). `.git` and
 * `.claude/` are the only exceptions -- both belong at the package root
 * under the new layout.
 */
async function moveEverythingElseToContent(boxRoot: string, contentRoot: string): Promise<string[]> {
  const moved: string[] = [];
  const entries = await fs.readdir(boxRoot);
  for (const entry of entries) {
    if (STAYS_AT_PACKAGE_ROOT.has(entry)) continue;
    if (entry === "src") continue; // just-created by extractCodeDirs
    const from = path.join(boxRoot, entry);
    const to = path.join(contentRoot, entry);
    await fs.mkdir(contentRoot, { recursive: true });
    await fs.rename(from, to);
    moved.push(entry);
  }
  return moved;
}

/**
 * Move a `.cb-box` marker's `shapeVersion` to 2. The marker already moved to
 * `content/.cb-box` by the time this runs.
 */
async function stampShapeVersion2(contentRoot: string): Promise<void> {
  const markerPath = path.join(contentRoot, ".cb-box");
  const raw = await fs.readFile(markerPath, "utf-8");
  const marker = raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, unknown>);
  marker.shapeVersion = 2;
  await fs.writeFile(markerPath, JSON.stringify(marker, null, 2) + "\n");
}

export type ClaudeProjectRelocationOutcome = "moved" | "noop" | "conflict";

export interface ClaudeProjectRelocationResult {
  outcome: ClaudeProjectRelocationOutcome;
  oldDir: string;
  newDir: string;
}

/**
 * Relocate `~/.claude/projects/<old-cwd-key>/` (Claude Code's per-project
 * session-transcript directory -- keyed by an encoding of the operating
 * cwd, see `encodeProjectDir` in `src/cli/lib/session.ts`) to the key for
 * the box's new operating cwd (`content/`). Silent memory/history loss on
 * this exact rename is a named failure mode in
 * `docs/plans/boxes-as-packages-v2.md` ("Failure modes" table) -- hence
 * this runs as part of the migration itself, not left to the runbook.
 *
 * - No directory at the old key: nothing to do (`noop`).
 * - Nothing at the new key: plain rename (`moved`) -- the common case.
 * - Something ALREADY at the new key (e.g. a coding session was opened at
 *   `content/` before migration): never clobber it. Both directories are
 *   left in place (`conflict`, logged as a warning, non-fatal), and a
 *   symlink named `<old-key>.moved-to` is left beside the old directory
 *   pointing at the new (authoritative) one, so a human or tool that goes
 *   looking from the old location can still find where history moved.
 */
export async function relocateClaudeProjectDir(args: {
  oldCwd: string;
  newCwd: string;
}): Promise<ClaudeProjectRelocationResult> {
  const root = claudeProjectsRoot();
  const oldDir = path.join(root, encodeProjectDir(path.resolve(args.oldCwd)));
  const newDir = path.join(root, encodeProjectDir(path.resolve(args.newCwd)));

  if (!(await pathExists(oldDir))) return { outcome: "noop", oldDir, newDir };
  if (oldDir === newDir) return { outcome: "noop", oldDir, newDir };

  if (await pathExists(newDir)) {
    const marker = `${oldDir}.moved-to`;
    try {
      await fs.rm(marker, { force: true });
    } catch (_e) {
      // Nothing there to clear -- expected on a first conflict.
    }
    await fs.symlink(newDir, marker);
    console.warn(
      `box-packageify: both ${oldDir} and ${newDir} exist in ~/.claude/projects -- leaving both untouched ` +
        `and marking ${marker} -> ${newDir} as authoritative. Review manually.`
    );
    return { outcome: "conflict", oldDir, newDir };
  }

  await fs.mkdir(path.dirname(newDir), { recursive: true });
  await fs.rename(oldDir, newDir);
  return { outcome: "moved", oldDir, newDir };
}

/**
 * Run the full conversion. Exported so `cb migrate` (via the CLI wrapper
 * below), the doctest, and the smoke-test script can all call it directly
 * and inspect the real result. `boxRoot` is the box's TOP-LEVEL directory
 * (the current legacy box root, which becomes the package root) -- not to
 * be confused with the `content/` path this function creates.
 */
export interface BoxPackageifyDeps {
  /**
   * Test-only fault injection, mirroring `cb upgrade`'s `CommandRunner` seam
   * (`src/cli/commands/upgrade.ts`) for exactly the same reason: the
   * revert-on-failure path needs to be exercised against a REAL mid-transform
   * failure without depending on an actual `pnpm`/`cb init` crash (slow,
   * flaky, environment-dependent) or filesystem-permission tricks (chmod-ing
   * a directory mid-run interacts badly with tap's own coverage/source-map
   * instrumentation touching the same tree, in ways that misattribute the
   * resulting error to an unrelated test — found the hard way writing this
   * migration's own doctest). Called right after `scaffoldPackageRoot`
   * succeeds (i.e. after real code/content moves have already happened) and
   * before `cb init`'s tail — throwing here exercises the same catch/revert
   * block a genuine late-stage failure would.
   */
  injectFailureAfterScaffold?: () => void;
}

export class InjectedTestFailureError extends Error {
  constructor() {
    super("box-packageify: injected test failure (injectFailureAfterScaffold) -- not a real error.");
    this.name = "InjectedTestFailureError";
  }
}

/**
 * Ready-made `injectFailureAfterScaffold` callback, exported so doctests
 * (`.doctest.md` example blocks can't cleanly hold a multi-brace function
 * literal — the markdown-to-test transform mis-parses nested `{ }` there)
 * can pass it straight through instead of defining their own.
 */
export function throwInjectedTestFailure(): void {
  throw new InjectedTestFailureError();
}

export async function runBoxPackageify(boxRoot: string, deps?: BoxPackageifyDeps): Promise<BoxPackageifyResult> {
  const resolvedRoot = path.resolve(boxRoot);
  // `detectBoxTarget` (not `getBoxShape`) is the right classifier here: it
  // checks BOTH `resolvedRoot` itself (legacy marker location) and
  // `resolvedRoot/content` (v2 marker location) before concluding "fresh"
  // (no box at all). `getBoxShape`/`getBoxShapeOrLegacyFallback` only ever
  // look at the exact path they're given, so calling this function a
  // SECOND time with the same top-level path (now a v2 box whose marker
  // moved to `content/.cb-box`) would misread it as a brand-new legacy box
  // rather than "already migrated" -- exactly the idempotency case this
  // migration must get right.
  const target = await detectBoxTarget(resolvedRoot);
  if (target.mode === "fresh") throw new NotABoxError(resolvedRoot);
  if (target.mode === "update-v2") return { status: "already-migrated" };

  if (!(await isRepo(resolvedRoot))) throw new NotAGitRepoError(resolvedRoot);
  if (!(await hasCommits(resolvedRoot))) throw new NoCommitsError(resolvedRoot);
  const status = await getStatus(resolvedRoot);
  if (!status.clean) throw new DirtyTreeError(resolvedRoot);

  // Precondition: no pre-existing package.json (BoxPackageConflictError's
  // usual home is scaffoldPackageRoot -- checked again here, BEFORE any
  // mutation, so a conflict aborts with the box completely untouched
  // rather than after code dirs have already moved).
  if (await pathExists(path.join(resolvedRoot, "package.json"))) {
    throw new BoxPackageConflictError(
      `Cannot packageify ${resolvedRoot}: it already has a package.json. box-packageify only ` +
        "converts a legacy box with no existing package wrapper."
    );
  }

  const snapshotSha = await getHead(resolvedRoot);
  const contentRoot = path.join(resolvedRoot, "content");

  try {
    await extractCodeDirs(resolvedRoot);
    await moveEverythingElseToContent(resolvedRoot, contentRoot);
    await stampShapeVersion2(contentRoot);

    // Memory continuity BEFORE scaffolding/cb init, so symlinkClaudeMemory
    // (called by runInit below) sees any relocated memory/ files already
    // sitting at the new project-dir key.
    await relocateClaudeProjectDir({ oldCwd: resolvedRoot, newCwd: contentRoot });

    // Reuses scaffoldPackageRoot wholesale: package.json/tsconfig.json/
    // thin root CLAUDE.md/.gitignore, and the node_modules-symlink-to-
    // running-engine policy -- see box-package.ts. Do not hand-roll any of
    // this a second time here.
    await scaffoldPackageRoot(resolvedRoot);
    deps?.injectFailureAfterScaffold?.();

    // Re-run cb init in update mode against the new content root so rules,
    // skills, validation hooks (re-embedding the content/ cwd), and
    // generated agent docs regenerate into their v2 locations. `runInit`
    // detects "update-v2" from `resolvedRoot` (package.json now present,
    // content/.cb-box now present) and does not re-scaffold or re-commit.
    await runInit(resolvedRoot, { skipGit: true, branch: "main" });

    await stageAll(resolvedRoot);
    const commitHash = await commit(resolvedRoot, {
      message: "migrate: box-packageify",
      trailers: { Migration: "box-packageify" },
    });

    return { status: "applied", packageRoot: resolvedRoot, contentRoot, commitHash };
  } catch (e) {
    await revertToSnapshot(resolvedRoot, snapshotSha);
    throw e;
  }
}

// CLI entry -- only when run directly, not when imported by a test/script.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const positional = args.find((a) => !a.startsWith("--"));
  if (positional === undefined) {
    console.error("Usage: box-packageify.ts <boxRoot> [--apply]");
    process.exit(1);
  }
  const resolvedRoot = path.resolve(positional);
  if (!apply) {
    const target = await detectBoxTarget(resolvedRoot);
    console.log(
      target.mode === "update-legacy"
        ? `${resolvedRoot} is a legacy box. Dry run only -- pass --apply to convert.`
        : `${resolvedRoot} is not a legacy box (mode: ${target.mode}) -- nothing to do.`
    );
  } else {
    const result = await runBoxPackageify(resolvedRoot);
    if (result.status === "already-migrated") {
      console.log(`${resolvedRoot} is already a v2 box -- nothing to do.`);
    } else {
      console.log(`Converted ${resolvedRoot} to a v2 box package (commit ${result.commitHash}).`);
      console.log(`  Package root: ${result.packageRoot}`);
      console.log(`  Content root: ${result.contentRoot}`);
    }
  }
}
