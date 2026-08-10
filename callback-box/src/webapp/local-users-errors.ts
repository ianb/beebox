/**
 * Error classes for the local credential store (`local-users.ts`).
 *
 * Split out to keep the store module under the line cap; imported back by it
 * and by the login/CLI surfaces that branch on these types.
 */

/**
 * Base for "the credential store cannot be trusted right now". Track D maps any
 * instance to the `auth-store-unavailable` request outcome (503) — never to
 * "no record", which would fail OPEN for exactly the sessions revocation exists
 * to kill.
 */
export class AuthStoreUnavailableError extends Error {
  constructor(message: string, opts?: { cause: unknown }) {
    super(message, opts);
    this.name = "AuthStoreUnavailableError";
  }
}

/**
 * Fail-closed marker thrown from the tRPC context factory when the credential
 * store is unavailable (Track D): the WS upgrade shares that factory and has no
 * HTTP reply to 503, so it throws instead of silently building an authed
 * context. For HTTP the box preHandler already answered 503 before this fires.
 */
export class AuthStoreUnavailableAtContextError extends AuthStoreUnavailableError {
  constructor(opts?: { cause: unknown }) {
    super("Auth store unavailable during request-context creation; failing closed.", opts);
    this.name = "AuthStoreUnavailableAtContextError";
  }
}

export class AuthFileCorruptError extends AuthStoreUnavailableError {
  readonly filePath: string;
  constructor(filePath: string, opts: { cause: unknown }) {
    const reason = opts.cause instanceof Error ? opts.cause.message : String(opts.cause);
    super(`Auth file at ${filePath} is corrupt: ${reason}. Refusing to load — fix or remove it by hand.`, {
      cause: opts.cause,
    });
    this.name = "AuthFileCorruptError";
    this.filePath = filePath;
  }
}

export class AuthFileSymlinkError extends AuthStoreUnavailableError {
  readonly filePath: string;
  constructor(filePath: string) {
    super(`Auth file at ${filePath} is a symlink; refusing to follow it.`);
    this.name = "AuthFileSymlinkError";
    this.filePath = filePath;
  }
}

export class UserExistsError extends Error {
  constructor(readonly email: string) {
    super(`A user with email ${email} already exists.`);
    this.name = "UserExistsError";
  }
}

export class NoSuchUserError extends Error {
  constructor(readonly email: string) {
    super(`No user with email ${email}.`);
    this.name = "NoSuchUserError";
  }
}

export class LastOwnerRemovalError extends Error {
  constructor(readonly email: string) {
    super(`Refusing to remove the owner account (${email}).`);
    this.name = "LastOwnerRemovalError";
  }
}

export class OwnerExistsError extends Error {
  constructor(readonly email: string) {
    super(`An owner account already exists; ${email} cannot also be an owner.`);
    this.name = "OwnerExistsError";
  }
}

export class NoOwnerError extends Error {
  constructor() {
    super("No owner account exists yet; create the first user before adding others.");
    this.name = "NoOwnerError";
  }
}

export class OwnerEmailMismatchError extends Error {
  constructor(
    readonly configured: string,
    readonly attempted: string,
  ) {
    super(`CB_OWNER_EMAIL is ${configured}; refusing to create a first owner as ${attempted}.`);
    this.name = "OwnerEmailMismatchError";
  }
}

export class AuthFileLockError extends AuthStoreUnavailableError {
  constructor(readonly lockPath: string) {
    super(`auth file lock could not be acquired at ${lockPath}`);
    this.name = "AuthFileLockError";
  }
}
