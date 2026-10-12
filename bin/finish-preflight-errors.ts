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
      `git merge main conflicted:\n${detail.conflicted}\n${detail.stdout}${detail.stderr}`,
      3,
    );
    this.name = "MergeConflictError";
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
