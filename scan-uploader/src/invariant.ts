/** Raised by {@link assertNever} — an exhaustive switch/if-chain reached a
 * case the type system said was impossible. */
export class UnreachableCaseError extends Error {
  constructor(value: never) {
    super("Unreachable case");
    this.name = "UnreachableCaseError";
    this.value = value;
  }
  readonly value: unknown;
}

/** Should-never-happen terminator for an exhaustive switch/if-chain. */
export function assertNever(value: never): never {
  throw new UnreachableCaseError(value);
}
