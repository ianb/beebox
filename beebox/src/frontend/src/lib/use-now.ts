import { useEffect, useState } from "react";

/**
 * A wall clock that re-renders on a fixed period, for captions that state an
 * age ("failed 3 hr ago"). A caption computed once at mount silently rots —
 * the pending capture bubble's whole defect was reading the same whether it
 * had been stuck for seconds or for weeks.
 *
 * Starts at `0` rather than `Date.now()` so render stays pure; callers treat a
 * zero clock as "age unknown yet" and show the un-aged caption for one frame.
 */
export function useNow(periodMs: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return now;
}
