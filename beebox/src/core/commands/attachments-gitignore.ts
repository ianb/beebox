/**
 * bbx attachments — gitignore management.
 *
 * One block: every box un-ignores its assets, so git-annex can see them. The
 * `unignore` subcommand writes it, and is the repair for a box whose
 * `.gitignore` was hand-edited back to hiding assets.
 *
 * The manifest-scheme half of this file (`init-gitignore`, `untrack-assets`,
 * and the block they wrote) is gone with the scheme. What survives of it is
 * the pair of MARKERS below, because `unignore` still has to RECOGNIZE a
 * retired block in order to replace one.
 *
 * Split out of attachments.ts to keep each file under the line cap. The
 * public command surface still lives in attachments.ts; these helpers are
 * imported back there.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CommandContext, CommandResult } from "../command-runner.js";
import { errnoCode } from "../../lib/error-guards.js";
import { CAPTURE_STAGING_IGNORE_PATTERN } from "../../lib/asset-extensions.js";


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

// The asset extension list and its renderers moved to src/lib/asset-extensions.ts —
// they define asset *identity*, not a gitignore detail, and are now shared with
// the git-annex classifier. Re-exported here for existing importers.
export { assetGitignorePatterns } from "../../lib/asset-extensions.js";



const UNIGNORE_BLOCK_MARKER = "# bbx-assets (managed by bbx attachments unignore)";

/**
 * Capture staging contains committed card metadata alongside unannexed media.
 * Re-include directories first: Git cannot re-include a file while one of its
 * parent directories remains excluded.
 */
const CAPTURE_STAGING_TRACKED_PATTERNS: readonly string[] = [
  "!**/tmp-capture/**/*.attach/**/",
  "!**/tmp-capture/**/*.attach/**/*.card",
  "!**/tmp-capture/**/*.attach/**/manifest.json",
  "!**/tmp-capture/**/*.attach/**/*.timing.json",
];

/**
 * The git-annex block: assets are tracked, only capture staging stays ignored.
 * The annex-converted counterpart of {@link GITIGNORE_BLOCK}, and likewise
 * exported so `bbx init` writes the identical text rather than a near-copy.
 */
export const UNIGNORE_BLOCK = `${UNIGNORE_BLOCK_MARKER}
# Assets inside .attach/ scopes are tracked by git-annex (annex.largefiles),
# so they are NOT ignored — git records a pointer, the annex holds the bytes.
# The one exception is capture staging: a capture is pre-triage and gets
# renamed, re-encoded, and EXIF-rotated before it is filed, so annexing it on
# arrival would mint objects for superseded versions. It joins the annex when
# an agent files it. See docs/plans/asset-annex.md.
${CAPTURE_STAGING_IGNORE_PATTERN}
${CAPTURE_STAGING_TRACKED_PATTERNS.join("\n")}
`;

/**
 * An asset ignore pattern, wherever it came from — inside the managed block,
 * hand-written, or left over from a reverted migration.
 *
 * Exported for the annex-shape probe (`core/annex/is-annex-box.ts`): "does this
 * `.gitignore` still hide assets from git" is the same question this asks, and
 * two spellings of one pattern is how the answer drifts.
 *
 * It drifted. This used to test `startsWith("**\/*.attach/**\/*.")`, which
 * misses the PATH-ANCHORED spelling — `/_content/**\/*.attach/**\/*.jpg` — that
 * the one-root migration carried over from a v2 box's own `.gitignore`. On a
 * box holding those, `to-annex` found no stray rules, reported success, and
 * left every asset ignored: reaching neither git nor the annex, with the
 * annex-shape gate reporting the box as converted. So the match is on the
 * distinctive middle of the pattern rather than its start.
 *
 * A negation (`!…`) is never an ignore rule, and the capture-staging
 * re-includes are spelled with the same middle — matching those would make the
 * managed block look like a pile of stray rules.
 *
 * @param line - A single `.gitignore` line
 */
const ASSET_IGNORE_RULE = /\*\*\/\*\.attach\/\*\*\/\*\./;

function isAssetIgnoreRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("!") || trimmed.startsWith("#")) return false;
  return ASSET_IGNORE_RULE.test(trimmed);
}

/** Does the box `.gitignore` still hide asset binaries from git? */
export async function gitignoreIgnoresAssets(boxRoot: string): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(path.join(boxRoot, ".gitignore"), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return false;
    throw e;
  }
  return text.split("\n").some((line) => isAssetIgnoreRule(line));
}

/**
 * Markers for the retired manifest-scheme asset block. The block is never
 * WRITTEN any more — every box is annex-shaped — but `unignoreGitignore` still
 * has to RECOGNIZE one to replace it, on a box whose `.gitignore` was
 * hand-edited back to hiding assets. Both spellings are matched: the rename
 * left older boxes on the legacy marker.
 */
const GITIGNORE_BLOCK_MARKER = "# bbx-assets (managed by bbx attachments init-gitignore)";
const LEGACY_GITIGNORE_BLOCK_MARKER = "# bbx-attach-binaries (managed by bbx attachments init-gitignore)";

/**
 * Is this line part of a retired manifest block's body — a comment or an asset
 * pattern? Used to find such a block's extent so it can be replaced.
 * Deliberately narrow: anything else (a blank line, an unrelated rule) ends the
 * block, so hand-written entries after it are never swallowed.
 */
function isManagedBlockLine(line: string): boolean {
  return line.startsWith("#") || line.startsWith("**/*.attach/**/*.");
}

/** Is `index` inside the managed asset block that starts at `start`? */
function inManagedBlock(lines: string[], opts: { index: number; start: number }): boolean {
  const { index, start } = opts;
  if (start === -1 || index <= start) return false;
  for (let i = start + 1; i <= index; i += 1) {
    if (!isManagedBlockLine(lines[i] ?? "")) return false;
  }
  return true;
}

/**
 * Is this line part of the unignore block's body? Same narrowness as
 * {@link isManagedBlockLine} — a comment or the capture-staging pattern.
 */
function isUnignoreBlockLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    line.startsWith("#") ||
    trimmed === CAPTURE_STAGING_IGNORE_PATTERN ||
    CAPTURE_STAGING_TRACKED_PATTERNS.includes(trimmed)
  );
}

/**
 * The inverse of `init-gitignore`, for the git-annex migration: drop the asset
 * extension block so `git add` can see the assets at all.
 *
 * This is a **required** migration step, not a tidy-up. A gitignored file never
 * reaches the annex — `annex.largefiles` is consulted by `git add`, which never
 * sees an ignored path — so leaving the block in place would silently produce a
 * box where no asset is annexed and nothing reports a problem.
 *
 * Replaces the asset block with the capture-staging rule rather than deleting
 * outright, because capture staging must stay ignored (see
 * {@link CAPTURE_STAGING_IGNORE_PATTERN}). Idempotent: re-running against an
 * already-converted `.gitignore` reports no change.
 */
/** What {@link unignoreGitignore} did. */
export interface UnignoreOutcome {
  changed: boolean;
  /** Asset ignore rules outside the managed block — a hard failure for callers. */
  strayRules: string[];
  /** One-line summary for the CLI. */
  message: string;
}

/**
 * The `.gitignore` half of the git-annex migration, callable without a
 * CommandContext so the migration can sequence it correctly (see
 * core/annex/to-annex.ts — the ordering relative to `annex.largefiles` is
 * load-bearing).
 */
export async function unignoreGitignore(boxRoot: string): Promise<UnignoreOutcome> {
  const gitignorePath = path.join(boxRoot, ".gitignore");
  let existing = "";
  try {
    existing = await fs.readFile(gitignorePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) !== "ENOENT") throw new GitignoreReadError(gitignorePath, e);
  }

  const lines = existing.split("\n");
  const assetBlockAt = lines.findIndex(
    (l) => l.trim() === GITIGNORE_BLOCK_MARKER || l.trim() === LEGACY_GITIGNORE_BLOCK_MARKER,
  );
  const unignoreBlockAt = lines.findIndex((l) => l.trim() === UNIGNORE_BLOCK_MARKER);

  // Asset rules NOT inside a managed block — hand-added, or left by a marker
  // that got edited away. Marker-presence alone is the wrong test: reporting
  // success while an `**/*.attach/**/*.jpg` line survives leaves a box where
  // those assets reach neither git nor the annex, silently.
  const strayRules = lines
    .filter((l, i) => isAssetIgnoreRule(l) && !inManagedBlock(lines, { index: i, start: assetBlockAt }))
    .map((l) => l.trim());
  if (strayRules.length > 0) {
    return {
      changed: false,
      strayRules,
      message:
        ".gitignore still ignores assets outside the managed block:\n" +
        strayRules.map((l) => `  ${l}`).join("\n") +
        "\nRemove these by hand — while they are present those assets reach neither " +
        "git nor the annex, and nothing else reports it.",
    };
  }

  if (assetBlockAt === -1 && unignoreBlockAt !== -1) {
    let end = unignoreBlockAt + 1;
    while (end < lines.length && isUnignoreBlockLine(lines[end] ?? "")) end += 1;
    const currentBlock = lines.slice(unignoreBlockAt, end).join("\n") + "\n";
    if (currentBlock === UNIGNORE_BLOCK) {
      return { changed: false, strayRules: [], message: "Already converted for git-annex — no change." };
    }
    await fs.writeFile(
      gitignorePath,
      [...lines.slice(0, unignoreBlockAt), UNIGNORE_BLOCK.trimEnd(), ...lines.slice(end)].join("\n"),
    );
    return { changed: true, strayRules: [], message: "Refreshed the git-annex block in .gitignore." };
  }

  if (assetBlockAt === -1) {
    const sep = existing === "" || existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.writeFile(gitignorePath, existing + sep + UNIGNORE_BLOCK);
    return { changed: true, strayRules: [], message: "No asset block found; added the capture-staging rule." };
  }

  let blockEnd = assetBlockAt + 1;
  while (blockEnd < lines.length && isManagedBlockLine(lines[blockEnd] ?? "")) blockEnd += 1;
  await fs.writeFile(
    gitignorePath,
    [...lines.slice(0, assetBlockAt), UNIGNORE_BLOCK.trimEnd(), ...lines.slice(blockEnd)].join("\n"),
  );
  return {
    changed: true,
    strayRules: [],
    message:
      "Removed the asset ignore block from .gitignore; assets are now visible to " +
      "`git add` and will be annexed. Capture staging stays ignored.",
  };
}

/** CLI wrapper: prints the outcome and fails on stray rules. */
async function runUnignore(ctx: CommandContext): Promise<CommandResult> {
  const outcome = await unignoreGitignore(ctx.boxRoot);
  ctx.writeLine(outcome.message);
  if (outcome.strayRules.length > 0) {
    return { success: false, error: `${String(outcome.strayRules.length)} unmanaged asset ignore rule(s)` };
  }
  return { success: true, data: { changed: outcome.changed } };
}

/** Tracked-but-now-ignored files, partitioned by whether they're assets. */




export { runUnignore };
