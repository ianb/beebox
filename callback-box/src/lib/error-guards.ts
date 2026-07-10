/**
 * Typed access to `unknown` caught values — the blessed alternative to casting
 * a catch binding.
 *
 * A `catch (e)` binding is `unknown`, and two casts recur across the codebase to
 * get at it: `(e as NodeJS.ErrnoException).code` for errno checks, and
 * `(e as Error).message` for message/stack access. Both are unsafe — the cast
 * asserts a shape the runtime never checked, so a non-Error throwable (a thrown
 * string, `undefined`, or a bare `{ code }` object) flows past mis-typed. These
 * helpers replace the casts with real runtime checks.
 *
 * They give *typed access only* — they never swallow, reword, or downgrade an
 * error. `toError` preserves the original throwable (identity when it is already
 * an Error; otherwise as `.cause`), so a caller that rethrows or inspects
 * `instanceof`/`.cause` keeps its semantics. Custom error classes pass through
 * `toError` unchanged.
 *
 * - `errnoCode(e)` — the `.code` of an errno-style throwable, or `undefined`. A
 *   safe property probe: no cast, no `instanceof` requirement.
 * - `isErrnoException(e)` — a type guard for callers that need more than `.code`
 *   (`.syscall`, `.path`, `.errno`).
 * - `toError(e)` — normalize any throwable to an `Error` for message/stack
 *   access, wrapping non-Errors and preserving the original as `.cause`.
 * - `errorMessage(e)` — the common one-liner: the message string of any
 *   throwable.
 */

/**
 * The `code` of an errno-style throwable (e.g. `"ENOENT"`, `"EEXIST"`), or
 * `undefined` when the value carries no string `code`. A duck-typed property
 * probe — it does not require the value to be an `Error`, so it matches the old
 * `(e as NodeJS.ErrnoException).code` cast exactly, minus the unsafety.
 *
 *   try { await fs.readFile(p); }
 *   catch (e) { if (errnoCode(e) === "ENOENT") return null; throw e; }
 */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e === "object" && e !== null && "code" in e) {
    const { code } = e;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Type guard for a Node errno exception — an `Error` carrying a string `.code`.
 * Use it when a caller needs the fuller `ErrnoException` shape (`.syscall`,
 * `.path`, `.errno`); for a bare `.code` check reach for {@link errnoCode}.
 */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e && typeof e.code === "string";
}

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
 * verbatim). The common replacement for `(e as Error).message`.
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
