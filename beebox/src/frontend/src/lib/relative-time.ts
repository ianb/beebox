/**
 * Human-readable elapsed time, for surfaces that must show how old something
 * is: a recovered dictation draft, a capture that has been stuck.
 *
 * Both take the elapsed milliseconds rather than a timestamp, so the caller
 * owns the clock and tests stay deterministic.
 */

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
