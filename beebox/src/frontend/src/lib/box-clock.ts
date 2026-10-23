import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The box's clock as the person sees it. A walk fixture's box can sit days
 * ahead of the host (`docs/plans/walk-simulated-time.md`); the server reports
 * that gap and displayed dates add it. Timers, expiry checks, ids and ordering
 * keys keep `Date.now()`: only a date shown to the person reads `boxNow()`.
 * With no gap (every real box) `boxNow()` is `Date.now()`.
 */

let shiftMs = 0;
const listeners = new Set<() => void>();

/** Store the gap the server reported between box time and this browser's clock. */
export function setBoxClockShift(next: number): void {
  if (next === shiftMs) return;
  shiftMs = next;
  for (const listener of listeners) listener();
}

let syncEpoch = 0;

/**
 * Start a sync for a newly current box: the previous box's gap is dropped at
 * once, so a real box never shows a walk box's shift. Returns the ticket that
 * the sync's reply must present to {@link applyBoxClockReply}.
 */
export function beginBoxClockSync(): number {
  syncEpoch += 1;
  setBoxClockShift(0);
  return syncEpoch;
}

/** Apply a reported gap unless a later {@link beginBoxClockSync} superseded its ticket. */
export function applyBoxClockReply({ epoch, reportedMs }: { epoch: number; reportedMs: number }): void {
  if (epoch !== syncEpoch) return;
  setBoxClockShift(reportedMs);
}

/** Epoch milliseconds on the box's clock, for dates shown to the person. */
export function boxNow(): number {
  return Date.now() + shiftMs;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getShift(): number {
  return shiftMs;
}

/**
 * Box time that re-renders every `periodMs` and when the reported gap changes.
 * Like `useNow`, starts at `0` so render stays pure; treat zero as "unknown yet".
 */
export function useBoxNow(periodMs: number): number {
  const shift = useSyncExternalStore(subscribe, getShift, getShift);
  const [real, setReal] = useState(0);
  useEffect(() => {
    setReal(Date.now());
    const timer = setInterval(() => setReal(Date.now()), periodMs);
    return () => clearInterval(timer);
  }, [periodMs]);
  return real === 0 ? 0 : real + shift;
}
