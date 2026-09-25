/**
 * Put a box's `.gitignore` back to hiding its assets — the retired
 * manifest-scheme block.
 *
 * Nothing in the engine writes this block any more: a box is annex-shaped from
 * its first commit and `bbx attachments init-gitignore` is gone with the rest
 * of the scheme. It is spelled out here because the state is still REACHABLE by
 * hand-editing a box `.gitignore`, and that is exactly the state several
 * guards exist to catch — `assertAnnexBox`, the scan-upload routes' retryable
 * 503, and `bbx doctor annex`'s gitignore check.
 *
 * Tests that want to exercise those guards have to build the state
 * deliberately, which is the honest shape: the production code no longer has a
 * path that produces it.
 */

import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { assetGitignorePatterns } from "../../src/lib/asset-extensions.js";

/** Append the retired asset ignore block, so assets are hidden from git again. */
export async function hideAssetsAgain(boxRoot: string): Promise<void> {
  await appendFile(
    join(boxRoot, ".gitignore"),
    `\n# bbx-assets (managed by bbx attachments init-gitignore)\n${assetGitignorePatterns()}\n`,
  );
}
