/**
 * Should-never-happen assertion — always throws when `cond` is falsy, in
 * every environment. Mirrors callback-box's `src/lib/invariant.ts` (not a
 * shared dependency; clerk is a standalone package).
 *
 *   const el = document.getElementById("root");
 *   invariant(el !== null, "entrypoint HTML must define a #root element");
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
