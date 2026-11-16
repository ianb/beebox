/** finish-preflight's failures, each with the exit code its caller keys on. */

export class PreflightError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "PreflightError";
    this.exitCode = exitCode;
  }
}

export class PrivateMountUnhealthyError extends PreflightError {
  constructor(readonly state: string) {
    super(`private-issues mount is ${state} — heal it or return BLOCKED`, 2);
    this.name = "PrivateMountUnhealthyError";
  }
}

export class MergeConflictError extends PreflightError {
  constructor(readonly detail: { conflicted: string; stdout: string; stderr: string }) {
    super(
      `git merge main conflicted; the merge is left in progress:\n${detail.conflicted}\n${detail.stdout}${detail.stderr}`,
      3,
    );
    this.name = "MergeConflictError";
  }
}

/** Merge state preflight will not touch, as {@link MergeStateError} reports it. */
export type StoppingMergeState =
  | { state: "conflicted"; mergeHead: string; paths: string[] }
  /** Conflicts resolved and staged, merge not committed. */
  | { state: "resolved-uncommitted"; mergeHead: string; staged: string[] }
  /** HEAD records the merge, but the index has changes on top of it. */
  | { state: "finished-with-staged"; mergeHead: string; staged: string[] }
  /** MERGE_HEAD names a merge HEAD does not record, and nothing is staged. */
  | { state: "unrecorded"; mergeHead: string }
  /** `git merge main` failed with no conflicted path: a file it would overwrite, a bad ref. */
  | { state: "merge-failed"; output: string };

function describeMergeState(found: StoppingMergeState): string {
  if (found.state === "merge-failed") return `git merge main failed without conflicts:\n${found.output}`;
  const head = `MERGE_HEAD ${found.mergeHead.slice(0, 9)}`;
  switch (found.state) {
    case "conflicted":
      return `a merge is in progress with conflicts (${head}); unmerged:\n${found.paths.join("\n")}`;
    case "resolved-uncommitted":
      return (
        `a merge is in progress with its conflicts resolved but not committed (${head}); staged:\n` +
        `${found.staged.join("\n")}\ncommit it (git commit --no-edit) or abort it (git merge --abort)`
      );
    case "finished-with-staged":
      return `HEAD records the merge of ${head}, but changes are staged on top of it:\n${found.staged.join("\n")}`;
    case "unrecorded":
      return `${head} is not HEAD's second parent, and nothing is staged`;
  }
}

/**
 * A merge already in progress that is not provably finished, or a
 * `git merge main` that failed without conflicts. The message names the state.
 */
export class MergeStateError extends PreflightError {
  constructor(readonly found: StoppingMergeState) {
    super(`merge state ${found.state}: ${describeMergeState(found)}`, 3);
    this.name = "MergeStateError";
  }
}

export class NotAWorktreeBranchError extends PreflightError {
  constructor(readonly branch: string) {
    super(`on '${branch}' — /finish is for worktree branches only`, 2);
    this.name = "NotAWorktreeBranchError";
  }
}

export class UsageError extends PreflightError {
  constructor(readonly detail: string, usage: string) {
    super(`${detail}\n${usage}`, 2);
    this.name = "UsageError";
  }
}
