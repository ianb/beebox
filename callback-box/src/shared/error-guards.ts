/**
 * Frontend+backend entry point for the caught-value / error typing helpers.
 *
 * The canonical implementation lives in the dependency-free `src/lib/error-guards.ts`
 * (the lowest, leaf layer). This module re-exports it so browser code — which the
 * import-boundary rule forbids from reaching into backend `src/lib/` — can import
 * the one implementation via `@shared/error-guards`. `shared/ → lib/` is the
 * sanctioned downward edge (see docs/module-map.md); keeping the source in `lib/`
 * preserves `lib/` as a leaf that imports nothing upward. The errno helpers are
 * type-only against `NodeJS.ErrnoException` (erased at build), so the whole module
 * stays bundler-safe for the browser.
 */
export {
  errnoCode,
  isErrnoException,
  toError,
  errorMessage,
  NonError,
} from "../lib/error-guards.js";
