/**
 * Frontend counterpart of the backend's `src/lib/error-guards.ts` (not directly
 * importable here — the frontend's tsconfig paths only expose `@backend/*` and
 * `@shared/*`, not backend-only `src/lib/`; see `invariant.ts` for the same
 * precedent). A minimal local copy carrying only the message-access helpers the
 * frontend actually uses — the errno helpers are backend-only.
 *
 * Typed access to `unknown` caught/error values — the blessed alternative to a
 * `(e as Error).message` cast. A `catch (e)` binding (and an XState `onError`
 * `event.error`) is `unknown`; casting it to `Error` asserts a shape the runtime
 * never checked, so a non-Error throwable (a thrown string, `undefined`, a bare
 * `{ message }` object) flows past mis-typed. These give *typed access only* —
 * they never swallow or reword an error, and preserve the original as `.cause`.
 *
 * - `toError(e)` — normalize any throwable to an `Error`, wrapping non-Errors
 *   and preserving the original as `.cause`.
 * - `errorMessage(e)` — the common one-liner: the message string of any
 *   throwable.
 */

/**
 * Normalize any caught value to an `Error`. An `Error` (including custom
 * subclasses) is returned unchanged, preserving identity for callers that
 * rethrow or branch on `instanceof`. A non-Error throwable is wrapped in a
 * {@link NonError}, keeping the original accessible as `.cause`.
 */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  return new NonError(e);
}

/**
 * The message string of any throwable — `error.message` for an `Error`, and a
 * best-effort string rendering for a non-Error (a thrown string comes through
 * verbatim). The blessed replacement for `(e as Error).message`.
 */
export function errorMessage(e: unknown): string {
  return toError(e).message;
}

/**
 * Wraps a non-Error throwable so message/stack access is typed. The original
 * value is preserved as `.cause` for inspection; the message is a best-effort
 * rendering of it.
 */
export class NonError extends Error {
  constructor(value: unknown) {
    super(describeThrowable(value), { cause: value });
    this.name = "NonError";
  }
}

function describeThrowable(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    // An error-shaped object (a plain object carrying a string `message`, as
    // some libraries throw) reads like the old `(e as Error).message` cast did.
    if ("message" in value && typeof value.message === "string") {
      return value.message;
    }
    try {
      // JSON.stringify is typed `: string` but returns undefined at runtime for
      // values that don't serialize; objects here always yield a string.
      return JSON.stringify(value);
    } catch (_e) {
      /* ignore: circular/unstringifiable value falls through to String() */
    }
  }
  return String(value);
}
