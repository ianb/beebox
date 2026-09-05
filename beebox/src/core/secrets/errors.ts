/**
 * Refusal types for the machine-level secret store (`docs/plans/secret-custody.md`,
 * Track 2).
 *
 * Every way a resolve can fail is its own class carrying a `kind` discriminant
 * and a message written for RELAY: the box agent reads it out to the boxholder
 * (or puts it in a question card) and the boxholder knows which action fixes
 * it. That is why `not-granted` and `dangling-grant` are separate types even
 * though both mean "no value came back" — the remediation differs (grant it vs
 * clean up a stale grant), and a caller that only had a string would have to
 * pattern-match prose to tell them apart.
 *
 * These are the error arm of a `Result` (see `lib/result.ts`): callers branch
 * on the cause, so a refusal is part of `resolveSecret`'s contract rather than
 * a thrown exception. They extend `Error` anyway so a caller that would rather
 * `throw` one keeps a stack and an `instanceof`.
 */

/** The closed vocabulary of resolver refusals (plan: "Vocabulary lock-ins"). */
export type SecretRefusalKind =
  | "unknown-secret"
  | "empty-slot"
  | "not-granted"
  | "agent-access-not-granted"
  | "dangling-grant"
  | "store-unreadable";

/** Shared shape: the refusal names the secret it is about, and carries a relay-ready message. */
abstract class SecretRefusalError extends Error {
  abstract readonly kind: SecretRefusalKind;
  /** The secret name that was asked for. */
  readonly secretName: string;

  constructor(secretName: string, message: string) {
    super(message);
    this.name = "SecretRefusalError";
    this.secretName = secretName;
  }
}

/** No entry with this name exists in the machine store at all. */
export class UnknownSecretError extends SecretRefusalError {
  readonly kind = "unknown-secret" as const;

  constructor(secretName: string) {
    super(
      secretName,
      `No secret named "${secretName}" exists on this machine. It can be declared ` +
        `(bbx secrets declare ${secretName}), but only the boxholder can supply its value.`,
    );
    this.name = "UnknownSecretError";
  }
}

/** The entry exists but was never filled in — a declared slot awaiting a value. */
export class EmptySecretSlotError extends SecretRefusalError {
  readonly kind = "empty-slot" as const;

  constructor(secretName: string) {
    super(
      secretName,
      `The secret "${secretName}" is declared but has no value yet. Ask the boxholder to supply it.`,
    );
    this.name = "EmptySecretSlotError";
  }
}

/** The secret exists, but this box has no grant for it. */
export class SecretNotGrantedError extends SecretRefusalError {
  readonly kind = "not-granted" as const;
  readonly boxSlug: string;

  constructor(opts: { secretName: string; boxSlug: string }) {
    super(
      opts.secretName,
      `This box ("${opts.boxSlug}") has no grant for the secret "${opts.secretName}". ` +
        "Ask the boxholder to grant it.",
    );
    this.name = "SecretNotGrantedError";
    this.boxSlug = opts.boxSlug;
  }
}

/** Granted for server use only; box/agent code asked for the value. */
export class SecretAgentAccessNotGrantedError extends SecretRefusalError {
  readonly kind = "agent-access-not-granted" as const;
  readonly boxSlug: string;

  constructor(opts: { secretName: string; boxSlug: string }) {
    super(
      opts.secretName,
      `The secret "${opts.secretName}" is granted to this box ("${opts.boxSlug}") for ` +
        "server use only, and box code asked for the value. Ask the boxholder to raise " +
        "the grant to agent access.",
    );
    this.name = "SecretAgentAccessNotGrantedError";
    this.boxSlug = opts.boxSlug;
  }
}

/** A grant names a secret whose entry has been removed. */
export class DanglingSecretGrantError extends SecretRefusalError {
  readonly kind = "dangling-grant" as const;
  readonly boxSlug: string;

  constructor(opts: { secretName: string; boxSlug: string }) {
    super(
      opts.secretName,
      `This box ("${opts.boxSlug}") is granted the secret "${opts.secretName}", but no ` +
        "such secret exists any more — the grant is stale. Ask the boxholder to re-add " +
        "the secret or revoke the stale grant.",
    );
    this.name = "DanglingSecretGrantError";
    this.boxSlug = opts.boxSlug;
  }
}

/** The store file could not be read or did not validate — machine-wide, fail closed. */
export class SecretStoreUnreadableError extends SecretRefusalError {
  readonly kind = "store-unreadable" as const;
  readonly storePath: string;

  constructor(opts: { secretName: string; storePath: string; detail: string }) {
    super(
      opts.secretName,
      `The machine's secret store (${opts.storePath}) could not be read: ${opts.detail}. ` +
        "No secret can be resolved until that is fixed — tell the boxholder; this is not " +
        "something the box can repair itself.",
    );
    this.name = "SecretStoreUnreadableError";
    this.storePath = opts.storePath;
  }
}

/** Every refusal a resolve can return. */
export type SecretRefusal =
  | UnknownSecretError
  | EmptySecretSlotError
  | SecretNotGrantedError
  | SecretAgentAccessNotGrantedError
  | DanglingSecretGrantError
  | SecretStoreUnreadableError;

/**
 * Lifecycle (mutation) failures, thrown rather than returned: a caller that
 * just asked to set or grant something cannot branch usefully on the cause, it
 * reports. One base class so every `bbx secrets` surface can catch the family
 * and print a clean line instead of a stack.
 */
export abstract class SecretLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretLifecycleError";
  }
}

/** A lifecycle operation named an entry that does not exist. */
export class SecretNotFoundError extends SecretLifecycleError {
  constructor(secretName: string) {
    super(`No secret named "${secretName}" exists. Declare or set it first.`);
    this.name = "SecretNotFoundError";
  }
}

/** `set` was given an empty value — that is what `declare` is for. */
export class EmptySecretValueError extends SecretLifecycleError {
  constructor() {
    super("Refusing to store an empty value — use `bbx secrets declare` for a slot awaiting a value.");
    this.name = "EmptySecretValueError";
  }
}

/**
 * A `uses` reason was empty, too long, or carried a line break.
 *
 * Uses are free prose (unlike a resolve `purpose`, which is a label) — they are
 * written by an agent and read by the boxholder on the admin page, so the only
 * constraints are the ones that keep the store and the page readable: one line,
 * and short enough to be a reason rather than a document.
 */
export class InvalidSecretUseError extends SecretLifecycleError {
  constructor(opts: { detail: string }) {
    super(`That is not a usable reason: ${opts.detail}. A use is one short line, e.g. "audio transcription".`);
    this.name = "InvalidSecretUseError";
  }
}

/** An entry's `uses` list is full — the reasons stopped being a short list. */
export class TooManySecretUsesError extends SecretLifecycleError {
  constructor(opts: { secretName: string; limit: number }) {
    super(
      `The secret "${opts.secretName}" already carries ${opts.limit} declared reasons, which is the limit. ` +
        "Replace one with `--remove-use` first, or fold several into a shorter line — this is a list a person reads.",
    );
    this.name = "TooManySecretUsesError";
  }
}

/** `--remove-use` named a reason the entry does not carry. */
export class SecretUseNotFoundError extends SecretLifecycleError {
  constructor(opts: { secretName: string; use: string }) {
    super(
      `The secret "${opts.secretName}" carries no declared reason "${opts.use}". ` +
        "It must match an existing line exactly; built-in reasons come from the engine and cannot be removed.",
    );
    this.name = "SecretUseNotFoundError";
  }
}

/** A grant was attempted on a structurally single-box secret. */
export class SecretNotShareableError extends SecretLifecycleError {
  constructor(opts: { secretName: string; owningBox: string | undefined; boxSlug: string }) {
    super(
      `The secret "${opts.secretName}" is marked single-box` +
        (opts.owningBox === undefined ? "" : ` (it belongs to "${opts.owningBox}")`) +
        ` and cannot also be granted to "${opts.boxSlug}". Some credentials bind to one box ` +
        "structurally — a Telegram bot token routes to a single webhook URL — so sharing one " +
        "would break the box already using it. Create a separate secret for this box.",
    );
    this.name = "SecretNotShareableError";
  }
}

/** `revoke` named a grant the box does not hold. */
export class SecretGrantNotFoundError extends SecretLifecycleError {
  constructor(opts: { secretName: string; boxSlug: string }) {
    super(`Box "${opts.boxSlug}" has no grant for "${opts.secretName}".`);
    this.name = "SecretGrantNotFoundError";
  }
}

/** The store could not be read by a lifecycle operation (list/status/mutate). */
export class SecretStoreAccessError extends SecretLifecycleError {
  constructor(opts: { storePath: string; detail: string; refusingWrite: boolean }) {
    super(
      `The secret store at ${opts.storePath} could not be read: ${opts.detail}.` +
        (opts.refusingWrite ? " Refusing to overwrite it — fix or move the file first." : ""),
    );
    this.name = "SecretStoreAccessError";
  }
}
