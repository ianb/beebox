/**
 * Should-never-happen assertion — always throws when `cond` is falsy. Not a
 * public export; internal to this package, mirroring beebox's
 * `src/lib/invariant.ts` for the same "impossible state, fail loud" cases.
 *
 *   invariant(value !== undefined, "key was just confirmed present");
 *   // value is now narrowed to non-undefined
 */
export function invariant(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Invariant violated: ${msg}`);
}
