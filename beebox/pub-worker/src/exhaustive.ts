/**
 * Local exhaustiveness terminator — the Worker imports ONLY `manifest-edge.ts`
 * from the box (a boundary the plan keeps deliberately thin), so it carries its
 * own tiny `assertNever` rather than reaching into `src/lib/invariant.ts`.
 * Reaching it means a manifest tier was added without a matching serve arm — a
 * compile error first, a loud throw if ever hit at runtime.
 */

/** An unhandled member of a union that was believed exhausted. */
export class UnhandledUnionMemberError extends Error {
  constructor(value: unknown) {
    super("Unhandled union member");
    this.name = "UnhandledUnionMemberError";
    this.value = value;
  }
  readonly value: unknown;
}

export function assertNever(x: never): never {
  throw new UnhandledUnionMemberError(x);
}
