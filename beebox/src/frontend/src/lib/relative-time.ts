/**
 * Human-readable time for surfaces that must say how old something is or how
 * long something took: a recovered dictation draft, a stuck capture, session
 * and commit lists, dashboard activity.
 *
 * Every function takes the clock as an argument (or names which clock to
 * read), so the caller owns it and tests stay deterministic.
 */

import { boxNow } from "./box-clock";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "just now" / "3m ago" / "2h ago" / "4d ago", then the date from a week on
 * ("Sep 15", plus ", 2025" when the year differs from `nowMs`'s). A stamp in
 * the future (the box clock behind this one) reads "just now".
 */
export function formatAgo(atMs: number, nowMs: number): string {
  const elapsed = nowMs - atMs;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m ago`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h ago`;
  if (elapsed < 7 * DAY) return `${String(Math.floor(elapsed / DAY))}d ago`;
  const at = new Date(atMs);
  const sameYear = at.getFullYear() === new Date(nowMs).getFullYear();
  return at.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/**
 * {@link formatAgo} for a timestamp. `box` reads a stamp the box wrote on its
 * own clock (commit dates); `real` reads the browser's clock, for stamps from
 * the host or elapsed time since a start. An unparseable string comes back as
 * written rather than "NaNd ago".
 */
export function agoOnClock(ts: string | number, clock: "box" | "real"): string {
  const at = typeof ts === "number" ? ts : Date.parse(ts);
  if (Number.isNaN(at)) return String(ts);
  return formatAgo(at, clock === "box" ? boxNow() : Date.now());
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
