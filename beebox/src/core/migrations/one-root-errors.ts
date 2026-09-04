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
