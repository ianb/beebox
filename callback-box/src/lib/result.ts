/**
 * The one Result convention for the codebase.
 *
 * A two-arm discriminated union keyed on `ok`, matching the house shape already
 * used by `core/place-mark.ts`'s `MarkResult`: the success arm carries `value`,
 * the failure arm carries `error`. Construct with {@link ok} / {@link err};
 * consume by branching on `.ok` (which narrows the union), never by reading a
 * field that only exists on one arm.
 *
 * ## When to return a Result vs throw
 *
 * This is a rule, not a preference:
 *
 * - **Callers branch on the failure → return a Result.** When the caller
 *   genuinely dispatches on *why* something failed (missing card vs parse error
 *   vs a step that gated), the failure is part of the function's contract and
 *   belongs in its signature. Tag the error arm (`E` as a discriminated union)
 *   so each cause is a distinct, matchable case.
 * - **A broken invariant → throw.** A "this can't happen" state is not a Result
 *   failure; wrapping it in `err` lets the program limp on in a broken state.
 *   Use `invariant()` / `assertNever()` (`lib/invariant.ts`), which throw.
 * - **An infrastructure failure → throw.** Disk, network, subprocess, and
 *   framework errors surface as exceptions and are caught at the boundary
 *   handlers that already exist. Don't launder them through a Result.
 *
 * The default error type is `string` (a human message), but prefer a tagged
 * union when callers act on the cause.
 */

/** A success carrying `value`, or a failure carrying `error`. */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Construct a success arm. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Construct a failure arm. */
export function err<E>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}
