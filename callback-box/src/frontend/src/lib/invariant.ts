/**
 * Frontend counterpart of the backend's `src/lib/invariant.ts` (not directly
 * importable here — the frontend's tsconfig paths only expose `@backend/*`
 * (webapp) and `@shared/*`, not backend-only `src/lib/`). Same contract: a
 * should-never-happen assertion that always throws, in every environment.
 *
 *   invariant(el !== null, "root element must exist");
 *   // el is now narrowed to non-null
 */
export function invariant(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new InvariantError(msg);
}

/** A broken internal invariant — an impossible state was reached. */
export class InvariantError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvariantError";
  }
}
