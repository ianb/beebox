/**
 * Keep `boxNow()` current: ask the server for the box clock's gap whenever the
 * current box changes and whenever the window regains focus (a walk's wait
 * moves it between visits). A box change drops the previous box's gap first,
 * and a reply that left for a previous box is ignored.
 */

import { useEffect } from "react";
import { trpcClient } from "../lib/trpc/client";
import { applyBoxClockReply, beginBoxClockSync } from "../lib/box-clock";

export function useBoxClockSync(boxSlug: string | undefined): void {
  useEffect(() => {
    // The request URL reads the current box at send time, so this effect (run
    // after the route changed) asks the new box.
    const epoch = beginBoxClockSync();
    const sync = () => {
      trpcClient.presence.clock.query().then(
        (result) => applyBoxClockReply({ epoch, reportedMs: result.shiftMs }),
        (e: unknown) => {
          // The gap stays at zero (or the last one reported) until the next focus.
          console.warn("[box-clock] sync failed:", e);
        },
      );
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, [boxSlug]);
}
