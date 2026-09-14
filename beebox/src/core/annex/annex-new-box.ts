/**
 * Make a newly-created box annex-shaped.
 *
 * This is the tail of what `bbx attachments to-annex` does (`./to-annex.ts`,
 * steps 4b-4c), and only the tail. The full migration is the wrong tool for a
 * fresh box in two ways, one of them fatal:
 *
 *  - It requires a clean tree and runs a disk preflight, against a directory
 *    that has neither assets nor a commit yet.
 *  - It CANNOT COMPLETE on a box with no assets. Its conversion commit has
 *    nothing to commit, so `git commit` exits 1 and the conversion reports
 *    failure over a box it actually converted correctly. A fresh box is the
 *    zero-asset case by definition. See
 *    `issues/bugs/2026-09-14-to-annex-fails-on-zero-asset-box.md`.
 *
 * Ordering is the same as the migration's and matters for the same reason:
 * annex must be configured BEFORE the assets are un-ignored, so that the first
 * `git add` to see an asset routes it into the annex rather than into a git
 * blob.
 */

import * as path from "node:path";
import type { GitAnnexService } from "../../services/git-annex.js";
import { assetLargefilesExpression } from "../../lib/asset-extensions.js";
import { writeAnnexInfoAttributes } from "./info-attributes.js";
import { writeBoxGitignore } from "../box/index.js";

/**
 * Initialize git-annex in a freshly-created box and un-ignore its assets.
 *
 * Idempotent: re-running on an already-annexed box re-applies the same config
 * and rewrites the same `.gitignore`.
 *
 * @param annex - The git-annex service.
 * @param boxRoot - The box root, which for a shapeVersion-3 box is also the
 *   git repository root.
 */
export async function annexNewBox(annex: GitAnnexService, boxRoot: string): Promise<void> {
  if (!(await annex.isInitialized(boxRoot))) {
    await annex.init(boxRoot, path.basename(boxRoot));
  }

  // annex.thin does NOT propagate to clones and defaults to leaving working-tree
  // files hardlinked to their annex objects, which silently disables fsck's
  // corruption detection. Set it explicitly rather than waiting for the doctor.
  await annex.setGitConfig(boxRoot, { key: "annex.thin", value: "false" });
  await annex.setAnnexConfig(boxRoot, {
    key: "annex.largefiles",
    value: assetLargefilesExpression(),
  });

  // Narrow the `* filter=annex` that `git annex init` writes into
  // `.git/info/attributes`. Unscoped it hands every path to the annex
  // filter-process — a fixed per-git-invocation cost paid by every text-only
  // commit this box will ever make.
  await writeAnnexInfoAttributes(boxRoot);

  // Last: the assets become visible to `git add`, now that the annex is
  // configured to claim them.
  await writeBoxGitignore(boxRoot, { annexed: true });
}
