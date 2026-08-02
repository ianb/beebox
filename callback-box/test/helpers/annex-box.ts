/**
 * Give a temp box the git-annex shape, without needing the git-annex binary.
 *
 * The annex-shape probe (`src/core/annex/is-annex-box.ts`) reads two pieces of
 * on-disk state: `.git/annex/` at the repository root, and a box `.gitignore`
 * that no longer hides assets from git. This helper produces both.
 *
 * The `.gitignore` half runs the REAL migration function, so a doctest box gets
 * exactly the file `cb attachments to-annex` would leave. The `.git/annex/`
 * half is the one thing fabricated here: only `git annex init` creates that
 * directory, and requiring the binary would make every scan doctest
 * environment-dependent for a directory whose contents nothing under test ever
 * reads.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { unignoreGitignore } from "../../src/core/commands/attachments-gitignore.js";
import { invariant } from "../../src/lib/invariant.js";

export async function makeBoxAnnexShaped(opts: { packageRoot: string; boxRoot: string }): Promise<void> {
  await mkdir(join(opts.packageRoot, ".git", "annex", "objects"), { recursive: true });
  const outcome = await unignoreGitignore(opts.boxRoot);
  invariant(outcome.strayRules.length === 0, `temp box could not be un-ignored: ${outcome.message}`);
}
