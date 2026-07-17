/** Raised when a session vanished between read and write (e.g. cancelled). */
export class StagingSessionGoneError extends Error {
  constructor(id: string) {
    super(`Staging session ${id} disappeared during a mutation`);
    this.name = "StagingSessionGoneError";
  }
}

/** Raised when an upload filename would escape the session directory. */
export class StagingPathError extends Error {
  constructor(filename: string) {
    super(`Unsafe staging filename: ${filename}`);
    this.name = "StagingPathError";
  }
}

/** A filename is an upload idempotency key and cannot be reused for new bytes. */
export class StagingUploadReplayConflictError extends Error {
  constructor(filename: string) {
    super(`Capture filename is already staged with different bytes: ${filename}`);
    this.name = "StagingUploadReplayConflictError";
  }
}
