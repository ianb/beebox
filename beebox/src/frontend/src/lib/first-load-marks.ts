import { useEffect } from "react";
import type { FirstLoadMark } from "@shared/first-load-marks";

/**
 * Records a first-load milestone as a `performance.mark`. Only the first call
 * per page load records: a later session switch or remount does not move it.
 * The marks cost one timeline entry each; DevTools' Performance panel and the
 * page-load harness (`docs/development/performance.md`) read them.
 */
export function markFirstLoad(mark: FirstLoadMark): void {
  if (performance.getEntriesByName(mark, "mark").length === 0) performance.mark(mark);
}

/** Marks `mark` after the first commit in which `reached` is true. */
export function useFirstLoadMark(mark: FirstLoadMark, reached: boolean): void {
  useEffect(() => {
    if (reached) markFirstLoad(mark);
  }, [mark, reached]);
}
