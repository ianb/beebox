/**
 * Every way `bin/coding-feedback` refuses, one class per failure. All extend
 * `UsageError`, which the CLI prints as `coding-feedback: <message>` with
 * exit 2.
 */

export class UsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export class InvalidCheckpointError extends UsageError {
  public constructor(allowed: readonly string[]) {
    super(`--checkpoint must be one of: ${allowed.join(", ")}`);
    this.name = "InvalidCheckpointError";
  }
}

export class InvalidEngineError extends UsageError {
  public constructor(allowed: readonly string[]) {
    super(`--engine must be one of: ${allowed.join(", ")}`);
    this.name = "InvalidEngineError";
  }
}

export class AllWithWorkstreamError extends UsageError {
  public constructor() {
    super("--all and --workstream are exclusive");
    this.name = "AllWithWorkstreamError";
  }
}

export class InvalidSinceError extends UsageError {
  public constructor(value: string) {
    super(`--since must be an ISO-8601 UTC instant such as 2026-10-07T00:00:00Z, not '${value}'`);
    this.name = "InvalidSinceError";
  }
}

export class InvalidWorkstreamError extends UsageError {
  public constructor(name: string) {
    super(`invalid workstream name '${name}' ([A-Za-z0-9_-]+, not 'apps')`);
    this.name = "InvalidWorkstreamError";
  }
}

export class EmptyBodyError extends UsageError {
  public constructor(prompts: readonly string[]) {
    super(`empty body; answer the four prompts on stdin or with --file:\n${prompts.join("\n")}`);
    this.name = "EmptyBodyError";
  }
}

export class StoreInsideCheckoutError extends UsageError {
  public constructor(root: string) {
    super(`store ${root} is inside the checkout; entries never go into git`);
    this.name = "StoreInsideCheckoutError";
  }
}

export class UnmarkedStoreError extends UsageError {
  public constructor(root: string, marker: string) {
    super(`${root} exists without ${marker}; refusing to write there`);
    this.name = "UnmarkedStoreError";
  }
}

export class NoFreeEntryNameError extends UsageError {
  public constructor(dir: string) {
    super(`could not find a free entry name in ${dir}`);
    this.name = "NoFreeEntryNameError";
  }
}

export class ShowArgumentsError extends UsageError {
  public constructor() {
    super("show takes exactly one path");
    this.name = "ShowArgumentsError";
  }
}

export class NotAnEntryError extends UsageError {
  public constructor(target: string, root: string) {
    super(`${target} is not a CODING_FEEDBACK entry under ${root}`);
    this.name = "NotAnEntryError";
  }
}

export class UnknownCommandError extends UsageError {
  public constructor(command: string, usage: string) {
    super(`unknown command '${command}'\n${usage}`);
    this.name = "UnknownCommandError";
  }
}

/** A `--transcript` path that is not on disk. */
export class TranscriptNotFoundError extends UsageError {
  public constructor(file: string) {
    super(`--transcript ${file} does not exist`);
    this.name = "TranscriptNotFoundError";
  }
}

/** A `--session` id with no transcript and no `--engine` to record it under. */
export class SessionNotFoundError extends UsageError {
  public constructor(sessionId: string) {
    super(`no transcript found for --session ${sessionId}; pass --engine to record it anyway`);
    this.name = "SessionNotFoundError";
  }
}
