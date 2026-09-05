/**
 * `.git/info/attributes` — which paths git hands to the git-annex
 * filter-process.
 *
 * git-annex claims the whole repository there (`* filter=annex`). We narrow it
 * to the asset extensions, which is the rendering half of
 * `assetAnnexAttributes()`; this module is the disk half plus the safety check
 * that makes narrowing legal.
 *
 * **The safety check is not optional.** A file already IN the annex whose
 * extension the scoped list does not cover loses its smudge filter the moment
 * the file is written: its working-tree copy becomes `/annex/objects/…` pointer
 * text on the next checkout, silently, and looks like data loss. So the
 * coverage of already-annexed paths is verified before the narrowed file is
 * ever written, and a gap is an error naming the list to extend — never a
 * quiet skip.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { writeFileAtomic } from "../../lib/atomic-write.js";
import { assetAnnexAttributes, isAssetExtension } from "../../lib/asset-extensions.js";
import { errnoCode } from "../../lib/error-guards.js";

/** Where git-annex's repository-local attributes live. */
export function annexInfoAttributesPath(repoRoot: string): string {
  return path.join(repoRoot, ".git", "info", "attributes");
}

/** Current contents, or null when the file does not exist. */
export async function readAnnexInfoAttributes(repoRoot: string): Promise<string | null> {
  try {
    return await fs.readFile(annexInfoAttributesPath(repoRoot), "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * Overwrite the file with the scoped rendering. Idempotent.
 *
 * A whole-file replace rather than a merge: git-annex owns this path and writes
 * a fixed one-line file, so there is no hand-authored content to preserve, and
 * a merge would have to guess which of two conflicting `filter=annex` claims
 * wins. Atomic, because a torn attributes file un-filters the repository.
 */
export async function writeAnnexInfoAttributes(repoRoot: string): Promise<void> {
  await writeFileAtomic(annexInfoAttributesPath(repoRoot), { content: assetAnnexAttributes() });
}

/**
 * Which of these annexed paths would lose their filter under the scoped list?
 *
 * Extension test rather than a glob match against the rendered lines: the
 * rendered lines ARE the extension list, and re-implementing wildmatch to check
 * them would be a second classifier to drift from the first. The one line that
 * is not an extension gets the same treatment — a substring test for the bulk
 * batch scope, matching what `BULK_BATCH_ATTACH_PATTERN` renders — so
 * a batch's `.zip` counts as covered instead of reading as a gap.
 */
export function uncoveredAnnexedPaths(annexedPaths: string[]): string[] {
  return annexedPaths.filter((p) => !isAssetExtension(p) && !isBulkBatchAttachPath(p));
}

/** Is this path inside a bulk-upload batch's attach scope? */
function isBulkBatchAttachPath(filePath: string): boolean {
  return filePath.includes(".upload-batch.attach/");
}
