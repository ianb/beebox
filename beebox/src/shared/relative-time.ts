/**
 * Elapsed time as short text, one style for the web app, the CLI, and health
 * checks: "just now", "3m ago", "2h ago", "4d ago" for how old something is,
 * and "850ms", "1.2s", "3m 20s", "1h 5m", "2d 3h" for how long something took.
 *
 * Every function takes the times as arguments, so the caller owns the clock
 * and tests stay deterministic.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, from an elapsed time: "just now" under a minute (and for a
 * negative elapsed time, a stamp from a clock running behind this one), then
 * the largest whole unit: "3m ago", "2h ago", "4d ago". Never a date.
 */
export function formatAgoMs(elapsedMs: number): string {
  if (!(elapsedMs >= MINUTE)) return "just now";
  if (elapsedMs < HOUR) return `${String(Math.floor(elapsedMs / MINUTE))}m ago`;
  if (elapsedMs < DAY) return `${String(Math.floor(elapsedMs / HOUR))}h ago`;
  return `${String(Math.floor(elapsedMs / DAY))}d ago`;
}

/**
 * {@link formatAgoMs} for a stamp, switching to the date from a week on
 * ("Sep 15", plus ", 2025" when the year differs from `nowMs`'s), for lists a
 * person scans.
 */
export function formatAgo(atMs: number, nowMs: number): string {
  const elapsed = nowMs - atMs;
  if (elapsed < 7 * DAY) return formatAgoMs(elapsed);
  const at = new Date(atMs);
  const sameYear = at.getFullYear() === new Date(nowMs).getFullYear();
  return at.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * How long something took: "850ms", "1.2s", "45s", then the two largest units
 * without a zero tail: "3m 20s", "3m", "1h 5m", "2d 3h".
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < SECOND) return `${String(Math.round(ms))}ms`;
  if (ms < 10 * SECOND) return `${(ms / SECOND).toFixed(1).replace(/\.0$/, "")}s`;
  if (ms < MINUTE) return `${String(Math.floor(ms / SECOND))}s`;
  const totalSeconds = Math.floor(ms / SECOND);
  const parts: [number, string][] = [
    [Math.floor(totalSeconds / 86_400), "d"],
    [Math.floor((totalSeconds % 86_400) / 3600), "h"],
    [Math.floor((totalSeconds % 3600) / 60), "m"],
    [totalSeconds % 60, "s"],
  ];
  const first = parts.findIndex(([n]) => n > 0);
  const [lead, next] = [parts[first], parts[first + 1]];
  if (lead === undefined) return "0ms";
  const head = `${String(lead[0])}${lead[1]}`;
  return next !== undefined && next[0] > 0 ? `${head} ${String(next[0])}${next[1]}` : head;
}
