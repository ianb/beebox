/** Typed access to a caught `unknown` — the local counterpart of
 * beebox's `src/lib/error-guards.ts` (not imported; no shared code). */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Narrows `unknown` to Node's `ErrnoException` shape (has a string `code`). */
export function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e;
}
