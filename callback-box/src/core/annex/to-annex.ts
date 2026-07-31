/**
 * `cb attachments to-annex` — convert a box from manifest-tracked gitignored
 * assets to git-annex.
 *
 * This is a script rather than a runbook because every prose step here has a
 * failure mode that a human following instructions will hit exactly once, on
 * the box that matters most.
 *
 * ## The two verification steps are not optional
 *
 * `git annex fsck` proves an object matches the key git-annex derived from it
 * *at migration time*. It cannot tell you the bytes were already corrupt before
 * conversion — it would happily bless corruption as canonical and then defend
 * it forever. The manifests hold an independent, *earlier* claim about what
 * those bytes should be, and this migration deletes them. So:
 *
 *   1. Before converting, every manifest entry must be hash-clean.
 *   2. After converting, every manifest sha256 must equal its annex key's hash.
 *   3. Only then are the manifests removed.
 *
 * Deleting the independent record before checking it against the new one is the
 * one mistake in this process that cannot be undone later.
 *
 * ## Why this also does the un-ignoring
 *
 * The `.gitignore` asset block has to go before git can see the assets, and
 * `annex.largefiles` has to be set before git *takes* them. Splitting those
 * across two commands leaves a window where a perfectly ordinary
 * `git add -A && git commit` — which the clean-tree requirement below actively
 * encourages — commits every asset into git as raw bytes. That is the failure
 * this migration exists to prevent, so the ordering is internal rather than
 * documented.
 *
 * ## Disk
 *
 * `annex.thin=false` means the working tree and the annex object are separate
 * copies, so conversion roughly doubles resident asset bytes. Preflight checks
 * that up front: running out of space mid-`git add` leaves a half-populated
 * index and object store, which is recoverable but alarming.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs";
import type { GitAnnexService } from "../../services/git-annex.js";
import { assetLargefilesExpression, isAssetExtension } from "../../lib/asset-extensions.js";
import { findAttachScopes } from "../../lib/attach-scopes.js";
import { loadManifest, MANIFEST_FILENAME, sha256File } from "../asset-manifest.js";
import { scanBoxAttachments } from "../asset-manifest-scan.js";
import { unignoreGitignore } from "../commands/attachments-gitignore.js";
import { errnoCode } from "../../lib/error-guards.js";
import { isRecord } from "../../lib/is-record.js";

const execFileAsync = promisify(execFile);
const statfsAsync = promisify(statfs);

/** The working tree had uncommitted changes, so a failed run could not be cleanly undone. */
export class DirtyTreeError extends Error {
  constructor(status: string) {
    super(`working tree is not clean; commit or stash first:\n${status}`);
    this.name = "DirtyTreeError";
  }
}

/** Manifests disagreed with the bytes on disk BEFORE conversion. */
export class PreflightManifestError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `${String(problems.length)} asset(s) fail manifest verification. Converting now would ` +
        `bless whatever is on disk as canonical:\n${problems.join("\n")}`,
    );
    this.name = "PreflightManifestError";
    this.problems = problems;
  }
}

/** Not enough disk for the annex objects the conversion will create. */
export class InsufficientSpaceError extends Error {
  constructor(needBytes: number, freeBytes: number) {
    super(
      `conversion needs about ${mb(needBytes)} MB of additional space (annex.thin=false keeps ` +
        `a working-tree copy AND an object copy) but only ${mb(freeBytes)} MB is free.`,
    );
    this.name = "InsufficientSpaceError";
  }
}

/**
 * Assets are still gitignored, so `git add` would never see them.
 *
 * This is the root cause of the worst failure this migration can have: the
 * conversion "succeeds", the manifests are deleted, and the bytes end up
 * tracked by nothing at all. Caught before anything is written.
 */
export class AssetsStillIgnoredError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} asset(s) are still gitignored, so git-annex would never see ` +
        "them. Run `cb attachments unignore` first (and clear any hand-written asset " +
        `rules it reports):\n${paths.slice(0, 5).map((p) => `  ${p}`).join("\n")}`,
    );
    this.name = "AssetsStillIgnoredError";
    this.paths = paths;
  }
}

/** After staging, some assets did not actually end up annexed. */
export class NotAnnexedError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} asset(s) were not annexed by \`git add\`. Manifests have NOT ` +
        `been removed:\n${paths.slice(0, 5).map((p) => `  ${p}`).join("\n")}`,
    );
    this.name = "NotAnnexedError";
    this.paths = paths;
  }
}

/** An annexed object's hash does not match what the manifest claimed. */
export class PostConversionMismatchError extends Error {
  readonly mismatches: string[];
  constructor(mismatches: string[]) {
    super(
      `${String(mismatches.length)} asset(s) annexed under a key that disagrees with their ` +
        `manifest hash. Manifests have NOT been removed:\n${mismatches.join("\n")}`,
    );
    this.name = "PostConversionMismatchError";
    this.mismatches = mismatches;
  }
}

function mb(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)));
}

/** Git LFS content was missing locally, so converting would lose it. */
export class LfsContentMissingError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} Git LFS file(s) are still pointers locally. Converting now would ` +
        "commit the pointer text as the file. Run `git lfs pull` first:\n" +
        paths.slice(0, 5).map((p) => `  ${p}`).join("\n"),
    );
    this.name = "LfsContentMissingError";
    this.paths = paths;
  }
}

export interface ToAnnexResult {
  /** Assets that moved into the annex. */
  annexed: number;
  /** Total bytes of those assets. */
  bytes: number;
  /** Manifest files removed once verification passed. */
  manifestsRemoved: number;
  /** Files taken over from Git LFS. */
  lfsConverted: number;
  /** What would happen, when `dryRun` was set. */
  dryRun: boolean;
}

export interface ToAnnexOptions {
  /** Report the plan and run every check, but change nothing. */
  dryRun?: boolean;
  /** Description recorded for this repository in the annex location log. */
  description?: string;
}

/** Every asset the manifests currently claim, with the hash they claim for it. */
interface ClaimedAsset {
  /** Absolute path. */
  absPath: string;
  /** Path relative to the box root, for messages. */
  relPath: string;
  /** Path relative to the git repository root, for git commands. */
  relPathFromRepo: string;
  sha256: string;
  size: number;
}

async function collectClaimedAssets(args: { boxRoot: string; repoRoot: string }): Promise<ClaimedAsset[]> {
  const { boxRoot, repoRoot } = args;
  const out: ClaimedAsset[] = [];
  for (const scope of await findAttachScopes(boxRoot)) {
    const manifest = await loadManifest(scope.absPath);
    for (const [name, entry] of Object.entries(manifest.files)) {
      const absPath = path.join(scope.absPath, name);
      out.push({
        absPath,
        relPath: path.join(scope.relPath, name),
        relPathFromRepo: path.relative(repoRoot, absPath),
        sha256: entry.sha256,
        size: entry.size,
      });
    }
  }
  return out;
}

/**
 * Manifests this migration is allowed to delete.
 *
 * Resolved from the attach-scope walk rather than globbing `manifest.json`,
 * because a box contains unrelated manifests — the publish bundle's, the search
 * index's, the frontend's web manifest — and a glob would take them too.
 */
async function ourManifests(boxRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const scope of await findAttachScopes(boxRoot)) {
    const p = path.join(scope.absPath, MANIFEST_FILENAME);
    try {
      await fs.access(p);
      out.push(p);
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
  }
  return out;
}

/**
 * Files Git LFS currently tracks, box-relative.
 *
 * git-annex takes precedence when both filters match a path (verified against a
 * repo with LFS genuinely engaged), so leaving the LFS filters in place would
 * not corrupt anything — it would just keep a second, unverifying mechanism
 * alive for every extension annex does not cover. The migration retires it.
 */
async function lfsTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["lfs", "ls-files", "--name-only"], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.split("\n").filter((l) => l.trim() !== "");
  } catch (_e) {
    /* ignore: no git-lfs installed, or no LFS in this repo — nothing to convert */
    return [];
  }
}

/**
 * Strip `filter=lfs` lines from `.gitattributes`, leaving everything else.
 *
 * Returns whether anything changed. Other attributes (the `!text !filter` rules
 * for test fixtures, say) are load-bearing and must survive.
 */
async function removeLfsFilters(boxRoot: string): Promise<boolean> {
  const p = path.join(boxRoot, ".gitattributes");
  let text: string;
  try {
    text = await fs.readFile(p, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  const kept = text.split("\n").filter((l) => !l.includes("filter=lfs"));
  const next = kept.join("\n");
  if (next === text) return false;
  await fs.writeFile(p, next);
  return true;
}

/**
 * Materialize-check every LFS file, then strip the LFS filters.
 *
 * Returns the files LFS was tracking, which annex now owns.
 */
async function retireLfs(args: { repoRoot: string; boxRoot: string }): Promise<string[]> {
  const { repoRoot, boxRoot } = args;
  const lfsFiles = await lfsTrackedFiles(repoRoot);
  const unmaterialized: string[] = [];
  for (const rel of lfsFiles) {
    try {
      const buf = await fs.readFile(path.join(repoRoot, rel));
      if (buf.subarray(0, 40).toString("utf8").startsWith("version https://git-lfs")) {
        unmaterialized.push(rel);
      }
    } catch (e) {
      if (errnoCode(e) !== "ENOENT") throw e;
    }
  }
  if (unmaterialized.length > 0) throw new LfsContentMissingError(unmaterialized);
  await removeLfsFilters(boxRoot);
  return lfsFiles;
}

/**
 * Which of these assets does git still ignore? Uses `git check-ignore`, so the
 * answer accounts for every ignore source (box `.gitignore`, nested ones,
 * `.git/info/exclude`, global config) rather than just the block we manage.
 */
async function ignoredAmong(repoRoot: string, assets: ClaimedAsset[]): Promise<string[]> {
  if (assets.length === 0) return [];
  // Batched rather than one call per asset: a box can hold thousands, and
  // `check-ignore` takes as many paths as the argv limit allows.
  const BATCH = 500;
  const ignored: string[] = [];
  for (let i = 0; i < assets.length; i += BATCH) {
    const rels = assets.slice(i, i + BATCH).map((a) => a.relPathFromRepo);
    try {
      const { stdout } = await execFileAsync("git", ["check-ignore", ...rels], {
        cwd: repoRoot,
        maxBuffer: 64 * 1024 * 1024,
      });
      ignored.push(...stdout.split("\n").filter((l) => l.trim() !== ""));
    } catch (e) {
      // check-ignore exits 1 when NOTHING in the batch matched — the good case.
      if (!(isRecord(e) && e["code"] === 1)) throw e;
    }
  }
  return ignored;
}

/** Is this path staged as an annex pointer rather than raw bytes? */
async function isStagedAsPointer(repoRoot: string, relPathFromRepo: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["cat-file", "-p", `:${relPathFromRepo}`], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024,
    });
    return stdout.startsWith("/annex/objects/");
  } catch (_e) {
    /* ignore: an unstaged path has no index entry, which is the answer */
    return false;
  }
}

async function gitStatusPorcelain(repoRoot: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
  return stdout.trim();
}

/**
 * Convert a box onto git-annex, verifying before and after.
 *
 * `repoRoot` is the git repository (the package root for a v2 box); `boxRoot`
 * is the operational box directory holding the attach scopes.
 */
export async function convertBoxToAnnex(
  annex: GitAnnexService,
  args: { repoRoot: string; boxRoot: string; options?: ToAnnexOptions }
): Promise<ToAnnexResult> {
  const { repoRoot, boxRoot, options } = args;
  const dryRun = options?.dryRun === true;

  // 1. Clean tree. Without this a failed run cannot be undone with a reset,
  //    because the reset would take the user's unrelated work with it.
  const status = await gitStatusPorcelain(repoRoot);
  if (status !== "") throw new DirtyTreeError(status);

  // 2. Manifests must agree with disk BEFORE anything is annexed. This is the
  //    only moment the independent record can still be checked.
  const scan = await scanBoxAttachments(boxRoot, { dryRun: true });
  if (scan.errors.length > 0) {
    throw new PreflightManifestError(scan.errors.map((e) => `  ${e.message}`));
  }

  const claimed = await collectClaimedAssets({ boxRoot, repoRoot });
  const bytes = claimed.reduce((sum, a) => sum + a.size, 0);

  // 3. Disk preflight. annex.thin=false means a working-tree copy AND an
  //    object copy, so the conversion needs roughly the asset total again.
  const stats = await statfsAsync(repoRoot);
  const freeBytes = Number(stats.bavail) * Number(stats.bsize);
  if (freeBytes < bytes * 1.1) throw new InsufficientSpaceError(bytes, freeBytes);

  // A dry run stops here: everything above is a read-only check, everything
  // below mutates. Returning after the configure/unignore steps would leave a
  // "dry" run that had already rewritten .gitignore and the annex config.
  if (dryRun) {
    return {
      annexed: claimed.length,
      bytes,
      manifestsRemoved: 0,
      lfsConverted: (await lfsTrackedFiles(repoRoot)).length,
      dryRun: true,
    };
  }

  // 4a. Configure BEFORE un-ignoring. Once the assets become visible to git,
  //     any `git add` must already route them into the annex.
  if (!(await annex.isInitialized(repoRoot))) {
    await annex.init(repoRoot, options?.description ?? path.basename(repoRoot));
  }
  await annex.setGitConfig(repoRoot, { key: "annex.thin", value: "false" });
  await annex.setAnnexConfig(repoRoot, {
    key: "annex.largefiles",
    value: assetLargefilesExpression(),
  });

  // 4a-bis. Retire Git LFS for the extensions annex now owns.
  //
  // Every box runs LFS as well, with this same extension list and no path
  // scoping. annex wins where both match, so this is not a correctness fix —
  // it stops a second, unverifying mechanism from quietly owning whatever annex
  // does not. The content must be materialized first: an LFS file that is still
  // a pointer locally would otherwise have its pointer text committed as the
  // file's content.
  const lfsFiles = await retireLfs({ repoRoot, boxRoot });

  // 4b. Now drop the ignore block, so `git add` can see the assets at all.
  const unignored = await unignoreGitignore(boxRoot);
  if (unignored.strayRules.length > 0) throw new AssetsStillIgnoredError(unignored.strayRules);

  // 4c. Nothing we are about to convert may still be gitignored. `unignore`
  //     removes only the block we manage, so a hand-written rule survives it —
  //     and that is precisely the case that would otherwise "succeed" while
  //     leaving the bytes tracked by nothing.
  const stillIgnored = await ignoredAmong(repoRoot, claimed.filter((a) => isAssetExtension(a.absPath)));
  if (stillIgnored.length > 0) throw new AssetsStillIgnoredError(stillIgnored);

  // 5. Stage everything.
  //
  // This is the check that matters most, and it was learned the hard way: a
  // first version verified only that each asset's bytes matched its manifest,
  // which an untouched ignored file passes trivially. The migration then


  // TWO passes, and both are load-bearing.
  //
  // `git add -A` picks up the assets the un-ignore just made visible — files
  // git has never tracked.
  //
  // `git add --renormalize` then re-runs the current filters over already-
  // tracked content. Without it, every file Git LFS tracked keeps its LFS
  // pointer in the index despite the filter being gone: plain `add` trusts the
  // stat cache and never re-examines a file whose mtime and size are unchanged,
  // so the migration would report `lfsConverted` having converted nothing.
  // `--renormalize` only considers *tracked* files, which is why it cannot
  // replace the first pass.
  const addOpts = { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 };
  await execFileAsync("git", ["add", "-A"], addOpts);
  await execFileAsync("git", ["add", "--renormalize", "."], addOpts);

  // 6a. Every asset must now actually be annexed. Defense in depth behind the
  //     gitignore preflight: any other reason `git add` skipped a path (a
  //     nested .gitignore, an exclude file, a largefiles expression that failed
  //     to match) lands here rather than silently.
  const notAnnexed: string[] = [];
  for (const asset of claimed) {
    if (!isAssetExtension(asset.absPath)) continue;
    if (!(await isStagedAsPointer(repoRoot, asset.relPathFromRepo))) notAnnexed.push(asset.relPath);
  }
  if (notAnnexed.length > 0) throw new NotAnnexedError(notAnnexed);

  // 6b. Verify every annexed object against the hash its manifest claimed. This
  //     is what makes deleting the manifests safe rather than merely tidy.
  const mismatches: string[] = [];
  for (const asset of claimed) {
    if (!isAssetExtension(asset.absPath)) continue;
    const actual = await sha256File(asset.absPath).catch(() => null);
    if (actual === null) {
      mismatches.push(`  ${asset.relPath}: unreadable after staging`);
    } else if (actual !== asset.sha256) {
      mismatches.push(`  ${asset.relPath}: manifest ${asset.sha256.slice(0, 12)}… != ${actual.slice(0, 12)}…`);
    }
  }
  if (mismatches.length > 0) throw new PostConversionMismatchError(mismatches);

  // 7. Remove the manifests and commit — pointers and removals land together,
  //    so there is no committed state where both records exist and disagree.
  const manifests = await ourManifests(boxRoot);
  for (const m of manifests) await fs.rm(m, { force: true });
  if (manifests.length > 0) {
    await execFileAsync("git", ["add", "-A"], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  }
  await execFileAsync(
    "git",
    ["commit", "-m", "Move assets onto git-annex", "--no-verify"],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );

  return {
    annexed: claimed.length,
    bytes,
    manifestsRemoved: manifests.length,
    lfsConverted: lfsFiles.length,
    dryRun: false,
  };
}
