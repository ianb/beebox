/**
 * Frontend-consumed re-export of the box namespace fence. Impl lives in
 * `src/lib/box-namespace.ts` (a dependency-free leaf); see that file's
 * doc comment and `docs/module-map.md`'s "frontend-consumed leaf helper"
 * pattern for why this thin re-export exists instead of a duplicate impl.
 */
export { isInBoxNamespace } from "../lib/box-namespace.js";
