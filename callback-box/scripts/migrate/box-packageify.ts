#!/usr/bin/env tsx

/**
 * `box-packageify` — convert a legacy (shapeVersion 1) box in place into the
 * v2 package layout described in "The box repository"
 * (`docs/implemented-plans/boxes-as-packages-v2.md`, Track H).
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
 * `src/lib/git.ts`) so ANY failure at ANY step restores the box to a
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
import { getStatus, isRepo, hasCommits, getHead, revertToSnapshot, stageAll, commit } from "../../src/lib/git.js";
import { detectBoxTarget, scaffoldPackageRoot, BoxPackageConflictError } from "../../src/core/box-package.js";
import { runInit } from "../../src/cli/commands/init.js";
import { encodeProjectDir, claudeProjectsRoot } from "../../src/cli/lib/session.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PACKAGE_ROOT } from "../../src/lib/package-root.js";

const execFileAsync = promisify(execFile);

export class PreexistingValidationError extends Error {
  constructor(boxRoot: string, validateOutput: string) {
    super(
      `${boxRoot} has pre-existing card validation errors -- box-packageify refuses to start ` +
        "(the conversion's final commit runs the box's own pre-commit validate hook, which " +
        "would reject these; fix the cards first rather than bypassing validation):\n\n" +
        validateOutput
    );
    this.name = "PreexistingValidationError";
  }
}

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
 *
 * A legacy box that happens to already have its own top-level `content/`
 * directory (its actual data dir is just named "content") is a special
 * case: `from` and the v2 `contentRoot` we're building are the SAME path,
 * so renaming it straight to `path.join(contentRoot, entry)` would mean
 * renaming that directory onto a path nested inside itself, which fails.
 * Shuffle it through a temp name instead: move it aside, create the
 * (now-empty) v2 `content/` root, then move the temp dir back in as
 * `content/content` -- everything else about the box is unaffected, the
 * box's own data dir just ends up one level deeper, same as it would if it
 * had been named anything else.
 */
async function moveEverythingElseToContent(boxRoot: string, contentRoot: string): Promise<string[]> {
  const moved: string[] = [];
  const entries = await fs.readdir(boxRoot);

  // Handle a pre-existing top-level `content/` FIRST, before touching
  // anything else: `contentRoot` (`<boxRoot>/content`) and this entry's
  // path are the SAME directory, so once any other entry's plain `mkdir` +
  // `rename` below runs, it would silently mkdir-no-op onto that same
  // existing legacy directory and start dumping unrelated top-level files
  // into it -- contaminating the legacy data before we ever get a chance
  // to shuffle it aside. Move it out of the way under a temp name up
  // front, so `contentRoot` starts the main loop as a path with nothing
  // there yet, then fold the temp dir back in as `content/content` last.
  const hasOwnContentDir = entries.includes("content");
  const tmpContentDir = path.join(boxRoot, ".box-packageify-tmp-content");
  if (hasOwnContentDir) {
    await fs.rename(path.join(boxRoot, "content"), tmpContentDir);
  }

  for (const entry of entries) {
    if (STAYS_AT_PACKAGE_ROOT.has(entry)) continue;
    if (entry === "src") continue; // just-created by extractCodeDirs
    if (entry === "content" && hasOwnContentDir) continue; // handled below
    const from = path.join(boxRoot, entry);
    const to = path.join(contentRoot, entry);
    await fs.mkdir(contentRoot, { recursive: true });
    await fs.rename(from, to);
    moved.push(entry);
  }

  if (hasOwnContentDir) {
    await fs.mkdir(contentRoot, { recursive: true });
    await fs.rename(tmpContentDir, path.join(contentRoot, "content"));
    moved.push("content");
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
 * `docs/implemented-plans/boxes-as-packages-v2.md` ("Failure modes" table) -- hence
 * this runs as part of the migration itself, not left to the runbook.
 * Callers decide whether/how to surface a non-`"moved"` outcome (this
 * function itself never logs) since `runBoxPackageify` -- the only caller --
 * runs it AFTER its own commit and wants that context in the message.
 *
 * - No directory at the old key: nothing to do (`noop`).
 * - Nothing at the new key: plain rename (`moved`) -- the common case when
 *   called in isolation, before anything else has touched the new key.
 * - Something ALREADY at the new key: never clobber it. Both directories are
 *   left in place (`conflict`), and a symlink named `<old-key>.moved-to` is
 *   left beside the old directory pointing at the new (authoritative) one,
 *   so a human or tool that goes looking from the old location can still
 *   find where history moved. `runBoxPackageify` calls this LAST, after its
 *   own `cb init` tail has already run `symlinkClaudeMemory` (which creates
 *   an empty directory at the new key to hold the memory symlink) -- so in
 *   practice a fresh box-packageify run almost always lands here, not on
 *   `"moved"`. That's fine: the old directory is untouched either way, only
 *   the (comparatively minor) session-transcript merge becomes a manual
 *   step instead of an automatic one.
 */
async function relocateProjectDirByAbsolutePaths(oldDir: string, newDir: string): Promise<ClaudeProjectRelocationResult> {
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
    return { outcome: "conflict", oldDir, newDir };
  }

  await fs.mkdir(path.dirname(newDir), { recursive: true });
  await fs.rename(oldDir, newDir);
  return { outcome: "moved", oldDir, newDir };
}

export async function relocateClaudeProjectDir(args: {
  oldCwd: string;
  newCwd: string;
}): Promise<ClaudeProjectRelocationResult> {
  const root = claudeProjectsRoot();
  const oldDir = path.join(root, encodeProjectDir(path.resolve(args.oldCwd)));
  const newDir = path.join(root, encodeProjectDir(path.resolve(args.newCwd)));
  return relocateProjectDirByAbsolutePaths(oldDir, newDir);
}

/**
 * Relocate the box-root project dir AND every "landmark chat" project dir
 * stranded under it. Claude Code sessions started at a subdirectory of the
 * box root (landmark chats, whose cwd is something like
 * `<boxRoot>/store/foo`) get their OWN `~/.claude/projects` key --
 * `encodeProjectDir` munges the full cwd, so a landmark key is always
 * `<box-root-key>-<munged-suffix>` (the path separator between the box root
 * and the subdirectory becomes the same `-` the encoder uses everywhere
 * else). `relocateClaudeProjectDir` alone only ever moved the box-root key
 * itself, leaving every landmark key stranded at its old (now-nonexistent)
 * cwd -- discovered by hand-sweeping the whole fleet after the first round
 * of `box-packageify` runs. This function enumerates `claudeProjectsRoot()`
 * for every directory name that IS the old box-root key or starts with
 * `<old box-root key>-`, and relocates each to the corresponding key under
 * the new box-root key, applying `relocateProjectDirByAbsolutePaths`'s same
 * never-clobber rules to each one independently (one landmark hitting a
 * `"conflict"` never blocks the others).
 */
export async function relocateAllClaudeProjectDirs(args: {
  oldCwd: string;
  newCwd: string;
}): Promise<ClaudeProjectRelocationResult[]> {
  const root = claudeProjectsRoot();
  const oldRootKey = encodeProjectDir(path.resolve(args.oldCwd));
  const newRootKey = encodeProjectDir(path.resolve(args.newCwd));

  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch (_e) {
    // No projects root at all (e.g. a fresh CB_CLAUDE_PROJECTS_DIR fixture) --
    // fall through with no landmark keys; the box-root move below still
    // no-ops correctly via relocateProjectDirByAbsolutePaths.
  }

  const landmarkKeys = entries.filter((name) => name !== oldRootKey && name.startsWith(`${oldRootKey}-`));

  const results: ClaudeProjectRelocationResult[] = [];
  results.push(await relocateProjectDirByAbsolutePaths(path.join(root, oldRootKey), path.join(root, newRootKey)));
  for (const oldKey of landmarkKeys) {
    const newKey = newRootKey + oldKey.slice(oldRootKey.length);
    results.push(await relocateProjectDirByAbsolutePaths(path.join(root, oldKey), path.join(root, newKey)));
  }
  return results;
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

  // Preflight validate: the conversion's final commit runs the box's own
  // pre-commit hook (cb validate --staged over the ENTIRE tree, since
  // everything moves), so a box with pre-existing broken cards would fail
  // at the last step and revert after doing all the work. Fail here
  // instead -- seconds in, box untouched, same verdict the hook would
  // give, with the actionable file list. Policy (boxholder, 2026-07-04):
  // fix the cards; never bypass the hook with --no-verify.
  try {
    await execFileAsync(path.join(PACKAGE_ROOT, "bin", "cb"), ["validate", "--all"], {
      cwd: resolvedRoot,
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new PreexistingValidationError(resolvedRoot, output);
  }

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

    // Session continuity (~/.claude/projects/<old-cwd-key> -> <content-key>)
    // runs LAST, after the commit above has made this migration
    // irreversible -- not mid-transform. It touches filesystem state
    // OUTSIDE git, so it can never be undone by `revertToSnapshot`; doing it
    // earlier meant a LATER failure (e.g. in `runInit` or `commit` itself)
    // would revert the box's tracked content back to legacy while leaving
    // session history stranded under the v2 key it never reached -- a
    // silent violation of this migration's all-or-nothing guarantee. Once
    // the commit has landed there's nothing left to revert TO, so a
    // relocation failure here is just a housekeeping miss, not a data-loss
    // risk: the directory is still sitting, fully intact, at the old key,
    // and `relocateClaudeProjectDir`'s own never-clobber behavior (see its
    // doc comment) means it's always safe to run by hand afterward too.
    try {
      const relocations = await relocateAllClaudeProjectDirs({ oldCwd: resolvedRoot, newCwd: contentRoot });
      for (const relocation of relocations) {
        if (relocation.outcome === "conflict") {
          console.warn(
            `box-packageify: migration committed (${commitHash}), but Claude Code session history ` +
              `at ${relocation.oldDir} could not be auto-merged into ${relocation.newDir} (both exist). ` +
              "Nothing was lost -- merge it by hand, e.g.:\n" +
              `  mv ${relocation.oldDir}/*.jsonl ${relocation.newDir}/`
          );
        }
      }
    } catch (e) {
      console.warn(
        `box-packageify: migration committed (${commitHash}), but relocating Claude Code session ` +
          `history from ${resolvedRoot} to ${contentRoot} in ~/.claude/projects failed: ` +
          `${(e as Error).message}. Nothing was lost -- the old session directory is untouched; ` +
          "move it by hand if you want continuity in future sessions."
      );
    }

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
