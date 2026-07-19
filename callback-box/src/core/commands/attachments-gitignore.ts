/**
 * cb attachments — gitignore management subcommands.
 *
 * The `init-gitignore` subcommand appends a managed block to the box's
 * `.gitignore` so asset binaries inside `.attach/` scopes are ignored
 * (they're tracked via per-dir manifest.json instead). The `untrack-assets`
 * subcommand drops already-tracked assets from the git index after verifying
 * the manifests cover them.
 *
 * Split out of attachments.ts to keep each file under the line cap. The
 * public command surface still lives in attachments.ts; these helpers are
 * imported back there.
 *
 * See docs/asset-manifests.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandContext, CommandResult } from "../command-runner.js";
import { type AssetManifest, loadManifest } from "../asset-manifest.js";
import { invariant } from "../../lib/invariant.js";
import { errnoCode, errorMessage } from "../../lib/error-guards.js";

const execFileAsync = promisify(execFile);

class GitignoreReadError extends Error {
  readonly gitignorePath: string;
  constructor(gitignorePath: string, cause: unknown) {
    super(`failed to read .gitignore: ${gitignorePath}`, { cause });
    this.name = "GitignoreReadError";
    this.gitignorePath = gitignorePath;
  }
}

/**
 * Marker that scopes the auto-appended asset block in `.gitignore`.
 * Lets us detect "already present" idempotently and (in the future) update
 * the block if we change the extension list.
 */
const GITIGNORE_BLOCK_MARKER = "# cb-assets (managed by cb attachments init-gitignore)";
/** Older marker the box may have if it was initialized before the rename. */
const LEGACY_GITIGNORE_BLOCK_MARKER = "# cb-attach-binaries (managed by cb attachments init-gitignore)";

/**
 * Extensions ignored inside `.attach/` scopes. THE list — the box scaffold's
 * `.gitignore` (core/box/index.ts) renders this same array, so a new asset type
 * is added here once rather than in two places that quietly drift.
 *
 * Nothing keys asset *identity* off this list: `listScopeBinaries` manifests
 * every non-`.card` file in a scope regardless of extension. This only decides
 * what git skips, so an omission here means the bytes get committed directly —
 * which is how frozen web pages (`page.frozen`, up to 41MB apiece) ended up in
 * box history before 2026-07-19.
 */
export const ASSET_GITIGNORE_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "tif",
  "tiff",
  "gif",
  "webm",
  "mp3",
  "m4a",
  "wav",
  "pdf",
  "mp4",
  "mov",
  // Frozen web-page snapshots captured by callback-clerk.
  "frozen",
];

/** The `.gitignore` lines for {@link ASSET_GITIGNORE_EXTENSIONS}. */
export function assetGitignorePatterns(): string {
  return ASSET_GITIGNORE_EXTENSIONS.map((ext) => `**/*.attach/**/*.${ext}`).join("\n");
}

const GITIGNORE_BLOCK = `${GITIGNORE_BLOCK_MARKER}
# Assets inside .attach/ scopes are tracked via per-dir manifest.json
# (size + sha256), not committed directly. See docs/asset-manifests.md.
${assetGitignorePatterns()}
`;

/**
 * Is this line part of the managed block's body — a comment or an asset
 * pattern? Used to find the block's extent so a stale one can be replaced.
 * Deliberately narrow: anything else (a blank line, an unrelated rule) ends
 * the block, so hand-written entries after it are never swallowed.
 */
function isManagedBlockLine(line: string): boolean {
  return line.startsWith("#") || line.startsWith("**/*.attach/**/*.");
}

/**
 * Install or refresh the asset block in the box's `.gitignore`.
 *
 * Idempotent, and — unlike the original append-only version — it **replaces a
 * stale block** rather than no-op'ing on the marker. Marker-presence alone was
 * never the right test: adding an extension to
 * {@link ASSET_GITIGNORE_EXTENSIONS} left every already-initialized box on the
 * old list forever, so a newly-ignored asset type kept getting committed on
 * exactly the boxes that had been running longest. (That's how `page.frozen`
 * stayed tracked after being added.) Creates `.gitignore` if absent.
 */
async function runInitGitignore(ctx: CommandContext): Promise<CommandResult> {
  const gitignorePath = path.join(ctx.boxRoot, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw new GitignoreReadError(gitignorePath, e);
  }

  const lines = existing.split("\n");
  const markerAt = lines.findIndex(
    (l) => l.trim() === GITIGNORE_BLOCK_MARKER || l.trim() === LEGACY_GITIGNORE_BLOCK_MARKER,
  );

  if (markerAt === -1) {
    const sep = existing === "" || existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.writeFile(gitignorePath, existing + sep + GITIGNORE_BLOCK);
    ctx.writeLine(`Appended asset block to ${path.relative(ctx.boxRoot, gitignorePath) || ".gitignore"}.`);
    return { success: true, data: { changed: true } };
  }

  let end = markerAt + 1;
  while (end < lines.length && isManagedBlockLine(lines[end] ?? "")) end += 1;

  const currentBlock = lines.slice(markerAt, end).join("\n") + "\n";
  if (currentBlock === GITIGNORE_BLOCK) {
    ctx.writeLine("Already up to date in .gitignore — no change.");
    return { success: true, data: { changed: false } };
  }

  const updated = [...lines.slice(0, markerAt), GITIGNORE_BLOCK.trimEnd(), ...lines.slice(end)].join("\n");
  await fs.writeFile(gitignorePath, updated);
  ctx.writeLine(`Refreshed asset block in ${path.relative(ctx.boxRoot, gitignorePath) || ".gitignore"}.`);
  return { success: true, data: { changed: true } };
}

/** Tracked-but-now-ignored files, partitioned by whether they're assets. */
interface PartitionedTrackedIgnored {
  inAttach: string[];
  outsideAttach: string[];
}

/**
 * Ask git which currently-tracked files the box's `.gitignore` would now
 * ignore. `git ls-files -i -c --exclude-standard` does exactly that:
 * tracked-but-now-ignored.
 */
async function listTrackedIgnored(boxRoot: string): Promise<string[]> {
  const res = await execFileAsync(
    "git",
    ["ls-files", "-z", "-i", "-c", "--exclude-standard"],
    { cwd: boxRoot, maxBuffer: 64 * 1024 * 1024 }
  );
  return res.stdout.split("\0").filter((s) => s.length > 0);
}

/**
 * Find the deepest `.attach/` directory enclosing a path. Returns the
 * scope's box-relative path, or null if none.
 *
 * Example:
 *   thread.attach/msg-001.attach/attachments/foo.png
 *   → thread.attach/msg-001.attach   (NOT thread.attach — deepest wins)
 */
function enclosingAttachScope(relPath: string): string | null {
  const parts = relPath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    invariant(part !== undefined, "i is within [0, parts.length) by the loop bounds");
    if (part.endsWith(".attach")) {
      return parts.slice(0, i + 1).join("/");
    }
  }
  return null;
}

/**
 * Given the attach-scoped files we're about to untrack, return the subset
 * not covered by their enclosing scope's manifest. Such files would lose
 * their inventory if untracked, so callers refuse when any are present.
 */
async function findUncoveredAssets(
  boxRoot: string,
  inAttach: string[]
): Promise<string[]> {
  const uncovered: string[] = [];
  const manifestCache = new Map<string, AssetManifest>();
  for (const relPath of inAttach) {
    const scope = enclosingAttachScope(relPath);
    if (!scope) {
      uncovered.push(relPath);
      continue;
    }
    const scopeAbs = path.join(boxRoot, scope);
    let manifest = manifestCache.get(scopeAbs);
    if (!manifest) {
      try { manifest = await loadManifest(scopeAbs); }
      catch (e) {
        // No manifest yet (or unreadable) — treat the scope as covering
        // nothing, so its files land in `uncovered` and the safety check
        // refuses to untrack them. Warn so a genuinely corrupt manifest is
        // visible rather than silently downgraded to "empty".
        console.warn(`Could not load manifest at ${scopeAbs}, treating as empty: ${e instanceof Error ? e.message : String(e)}`);
        manifest = { files: {} };
      }
      manifestCache.set(scopeAbs, manifest);
    }
    const scopeRel = relPath.slice(scope.length + 1);  // strip "<scope>/"
    if (!manifest.files[scopeRel]) uncovered.push(relPath);
  }
  return uncovered;
}

/** Split tracked-ignored files into attach-scope assets vs everything else. */
function partitionTrackedIgnored(trackedIgnored: string[]): PartitionedTrackedIgnored {
  const inAttach: string[] = [];
  const outsideAttach: string[] = [];
  for (const relPath of trackedIgnored) {
    if (relPath.includes(".attach/")) inAttach.push(relPath);
    else outsideAttach.push(relPath);
  }
  return { inAttach, outsideAttach };
}

/** `git rm --cached` the given files, chunked to avoid argv overflow. */
async function gitRmCached(boxRoot: string, files: string[]): Promise<void> {
  const CHUNK = 100;
  for (let i = 0; i < files.length; i += CHUNK) {
    const slice = files.slice(i, i + CHUNK);
    await execFileAsync("git", ["rm", "--cached", "--quiet", "--", ...slice], {
      cwd: boxRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  }
}

/**
 * Migration step: ask git which currently-tracked files would now be ignored
 * by the box's `.gitignore`, and `git rm --cached` them. Working-tree files
 * stay (they're on disk and the manifests reference them); only the git
 * index drops them. Pre-existing history still carries the blobs, but
 * future commits will not.
 *
 * Idempotent: a second run finds no tracked-but-ignored files and is a no-op.
 *
 * Refuses to run if the manifests don't cover everything we're about to
 * untrack — running this before `cb attachments migrate` would lose the
 * inventory.
 */
async function runUntrackAssets(ctx: CommandContext): Promise<CommandResult> {
  let trackedIgnored: string[];
  try {
    trackedIgnored = await listTrackedIgnored(ctx.boxRoot);
  } catch (e) {
    return { success: false, error: `git ls-files failed: ${errorMessage(e)}` };
  }
  if (trackedIgnored.length === 0) {
    ctx.writeLine("Nothing to untrack — no currently-tracked files match the gitignore.");
    return { success: true, data: { untracked: 0 } };
  }

  // Safety check: every file we're about to untrack must be either covered
  // by an asset manifest (so we can verify integrity later) or be a non-
  // attach file (in which case the user is doing something we don't know
  // about — refuse). Files outside .attach/ scopes aren't our concern; we
  // only handle assets here.
  const { inAttach, outsideAttach } = partitionTrackedIgnored(trackedIgnored);
  if (outsideAttach.length > 0) {
    ctx.writeLine(`Skipping ${outsideAttach.length} file(s) outside .attach/ scopes (gitignored for other reasons):`);
    for (const p of outsideAttach.slice(0, 5)) ctx.writeLine(`  ${p}`);
    if (outsideAttach.length > 5) ctx.writeLine(`  ...and ${outsideAttach.length - 5} more`);
  }
  if (inAttach.length === 0) {
    ctx.writeLine("No tracked assets to untrack.");
    return { success: true, data: { untracked: 0 } };
  }

  // Verify each file is covered by its enclosing attach scope's manifest.
  // A binary at `msg-001.attach/attachments/foo.png` belongs to
  // `msg-001.attach/manifest.json` under key `attachments/foo.png`.
  const uncovered = await findUncoveredAssets(ctx.boxRoot, inAttach);
  if (uncovered.length > 0) {
    ctx.writeLine(`Refusing to untrack: ${uncovered.length} file(s) are not covered by a manifest.`);
    ctx.writeLine("Run 'cb attachments migrate' first so every binary is tracked.");
    for (const p of uncovered.slice(0, 5)) ctx.writeLine(`  ${p}`);
    if (uncovered.length > 5) ctx.writeLine(`  ...and ${uncovered.length - 5} more`);
    return {
      success: false,
      error: `${uncovered.length} asset(s) not in manifest`,
    };
  }

  await gitRmCached(ctx.boxRoot, inAttach);
  ctx.writeLine(`Untracked ${inAttach.length} asset(s) from the git index.`);
  ctx.writeLine("Working-tree files are preserved. Manifests cover them. Commit to finalize.");
  return { success: true, data: { untracked: inAttach.length } };
}

export { runInitGitignore, runUntrackAssets };
