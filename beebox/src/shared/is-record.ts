/**
 * Frontend+backend entry point for `isRecord`.
 *
 * The canonical implementation lives in the dependency-free `src/lib/is-record.ts`
 * (the lowest, leaf layer). This module re-exports it so browser code — which the
 * import-boundary rule forbids from reaching into backend `src/lib/` — can import
 * the one implementation via `@shared/is-record`. `shared/ → lib/` is the
 * sanctioned downward edge (see docs/module-map.md); keeping the source in `lib/`
 * preserves `lib/` as a leaf that imports nothing upward.
 */
export { isRecord } from "../lib/is-record.js";
