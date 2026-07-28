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

/**
 * Raised when a commit/registration that passed the pre-lock `state === "open"`
 * check finds the session already sealed under the lock — the finalize-vs-upload
 * race. The seal is a barrier: a session that raced closed rejects here rather
 * than mutating a sealed batch. Maps to 409.
 */
export class StagingSessionNotOpenError extends Error {
  constructor(id: string, state: string) {
    super(`Staging session ${id} is ${state}, not open`);
    this.name = "StagingSessionNotOpenError";
  }
}

/**
 * Raised when a streamed upload's `itemId` isn't in the session's predeclared
 * registry at commit time (re-checked under the lock as a barrier against the
 * pre-lock check going stale). Maps to 409.
 */
export class StagingItemNotRegisteredError extends Error {
  constructor(itemId: string) {
    super(`No registered item ${itemId} in this bulk batch`);
    this.name = "StagingItemNotRegisteredError";
  }
}
