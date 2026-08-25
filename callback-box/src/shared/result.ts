/**
 * Frontend+backend entry point for the Result convention.
 *
 * The canonical implementation lives in the dependency-free `src/lib/result.ts`
 * (the lowest, leaf layer). This module re-exports it so browser code — which
 * the import-boundary rule forbids from reaching into backend `src/lib/` — can
 * import the one Result shape via `@shared/result`, exactly as
 * `shared/invariant.ts` does for the invariant helpers (see docs/module-map.md).
 */
export { ok, err, type Result } from "../lib/result.js";
