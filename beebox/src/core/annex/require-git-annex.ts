/**
 * The git-annex install preflight for box creation.
 *
 * git-annex is a hard dependency of every box: a box is annex-shaped from its
 * first commit, and once `.git/annex/` exists the installed pre-commit hook
 * exits 1 on EVERY commit while the binary is missing
 * (`src/core/install-validation-hooks.ts`), not just on commits that touch
 * assets. That is correct — committing without the clean filter would put
 * asset bytes straight into history — but it means a box created on a machine
 * without git-annex is a box nobody can commit to.
 *
 * So the refusal has to land before the box exists. This is the one moment the
 * user can still act on it, and the only moment at which nothing has to be
 * undone.
 *
 * Deliberately not a repair: `bbx init` does not install system packages. It
 * names the install line and stops.
 */

import type { GitAnnexService } from "../../services/git-annex.js";

/**
 * The install line, shared verbatim with `runAnnexDoctor`'s binary check and
 * the pre-commit hook. One spelling across all three surfaces — a user who
 * meets this twice should not have to work out whether they are the same
 * requirement.
 */
export const GIT_ANNEX_INSTALL_HINT = "Install it (`apt install git-annex` / `brew install git-annex`).";

/**
 * The git-annex binary is not installed, and a box cannot be created without
 * it.
 *
 * A distinct class rather than a bare Error because `bbx init` is not the only
 * caller that will want to recognize this: box creation happens from the CLI,
 * from `deploy/add-box.sh`, and from worktree setup, and each reports failure
 * differently.
 */
export class GitAnnexRequiredError extends Error {
  constructor() {
    super(
      "git-annex is required to create a Bee Box: a box tracks its assets in the annex from its " +
        "first commit, and without the binary every commit on that box fails. " +
        GIT_ANNEX_INSTALL_HINT,
    );
    this.name = "GitAnnexRequiredError";
  }
}

/**
 * Throw unless the git-annex binary is on PATH.
 *
 * @param annex - The git-annex service; `version()` returns null when the
 *   binary is absent, which is a normal result rather than an error.
 * @throws GitAnnexRequiredError naming the install line when git-annex is not
 *   installed.
 */
export async function requireGitAnnex(annex: GitAnnexService): Promise<void> {
  const version = await annex.version();
  if (version !== null) return;
  throw new GitAnnexRequiredError();
}
