/**
 * Keep `boxNow()` current: ask the server for the box clock's gap on load and
 * whenever the window regains focus (a walk's wait moves it between visits).
 */

import { useEffect } from "react";
import { trpcClient } from "../lib/trpc/client";
import { setBoxClockShift } from "../lib/box-clock";

export function useBoxClockSync(): void {
  useEffect(() => {
    const sync = () => {
      trpcClient.presence.clock.query().then(
        (result) => setBoxClockShift(result.shiftMs),
        (e: unknown) => {
          // The previous gap stays; displayed dates are off by it until the next focus.
          console.warn("[box-clock] sync failed:", e);
        },
      );
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);
}
