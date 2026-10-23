/**
 * Human-readable elapsed time, for surfaces that must show how old something
 * is: a recovered dictation draft, a capture that has been stuck.
 *
 * `formatElapsed` and `formatAgo` take the elapsed milliseconds rather than a
 * timestamp, so the caller owns the clock and tests stay deterministic.
 * `compactAgo` takes a timestamp and reads the clock itself.
 */

import { boxNow } from "./box-clock";

/** "3 min" / "2 hr" / "4 days" — the magnitude, without a preposition. */
export function formatElapsed(elapsedMs: number): string {
  const sec = Math.floor(elapsedMs / 1000);
  const min = Math.round(sec / 60);
  if (min < 60) return `${String(Math.max(1, min))} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${String(hr)} hr`;
  const days = Math.round(hr / 24);
  return `${String(days)} ${days === 1 ? "day" : "days"}`;
}

/** "just now" / "3 min ago" / "2 hr ago" / "4 days ago". */
export function formatAgo(elapsedMs: number): string {
  if (elapsedMs < 45_000) return "just now";
  return `${formatElapsed(elapsedMs)} ago`;
}

/**
 * "45s ago" / "3m ago" / "2h ago" / "4d ago" for a timestamp. `box` reads a
 * stamp the box wrote on its own clock (commit dates); `real` reads the
 * browser's clock, for stamps from the host or elapsed time since a start.
 */
export function compactAgo(ts: string | number, clock: "box" | "real"): string {
  const elapsed = (clock === "box" ? boxNow() : Date.now()) - (typeof ts === "number" ? ts : new Date(ts).getTime());
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
