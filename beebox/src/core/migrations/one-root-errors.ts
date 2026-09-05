/**
 * The `one-root` migration's error classes — split out so both the
 * orchestrator (`one-root-run.ts`) and its move-planning half
 * (`one-root-move-plan.ts`) can throw them without an import cycle.
 * Re-exported from `one-root-run.ts` for callers (doctests included) that
 * import them from there.
 */

export class OneRootPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OneRootPreflightError";
  }
}

export class OneRootLinkGateError extends Error {
  constructor(report: string) {
    super(report);
    this.name = "OneRootLinkGateError";
  }
}

/**
 * Finding 1 (Track E hardening review, round 3): the migration failed AND
 * its rollback could not fully restore the pre-migration tree (an
 * untracked-rename-back, a `.beebox` rename-back, or an in-place content
 * restore failed). Refusing to run any further destructive cleanup — stray
 * package-root entry removal, `git clean -fd` via `revertToSnapshot` —
 * matters here specifically: either step could delete data a failed
 * restore left stranded (e.g. a gitignored secret sitting at its
 * half-migrated destination). The tree is left exactly as the failed
 * rollback left it; `cause` carries the ORIGINAL migration failure that
 * triggered the rollback attempt in the first place.
 */
export class OneRootRollbackError extends Error {
  constructor(params: { failures: string[]; cause: unknown }) {
    super(
      "one-root migration failed AND its rollback could not fully restore the pre-migration tree — refusing to " +
        "run further destructive cleanup (stray-entry removal, git clean) on top of an incomplete restore. The " +
        `tree has been left AS-IS. Manual recovery needed for:\n  ${params.failures.join("\n  ")}`,
      { cause: params.cause },
    );
    this.name = "OneRootRollbackError";
  }
}

/** A formerly-gitignored `content/` entry is no longer covered by the
 * regenerated v3 root `.gitignore` at its new path — refuses to commit
 * rather than risk `git add -A` picking up a secret. */
export class OneRootGitignoreRegressionError extends Error {
  constructor(paths: string[]) {
    super(
      "one-root migration: the following formerly-ignored path(s) are no longer covered by the " +
        "regenerated .gitignore at their new location — refusing to migrate rather than risk " +
        `committing a secret:\n  ${paths.join("\n  ")}`,
    );
    this.name = "OneRootGitignoreRegressionError";
  }
}
