/**
 * Frontend+backend entry point for the invariant/exhaustiveness helpers.
 *
 * The canonical implementation lives in the dependency-free `src/lib/invariant.ts`
 * (the lowest, leaf layer). This module re-exports it so browser code — which the
 * import-boundary rule forbids from reaching into backend `src/lib/` — can import
 * the one implementation via `@shared/invariant`. `shared/ → lib/` is the
 * sanctioned downward edge (see docs/module-map.md; `shared/parse-attrs.ts` and
 * `shared/self-note.ts` already lean on `lib/invariant` the same way); keeping the
 * source in `lib/` preserves `lib/` as a leaf that imports nothing upward.
 */
export {
  assertNever,
  invariant,
  checkInvariant,
  tolerateNever,
  InvariantError,
} from "../lib/invariant.js";
