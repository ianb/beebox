import { formatClock } from "@shared/relative-time";

const HOUR_MS = 3_600_000;

/** Time between two commits as a clock, or null when either date is invalid, the gap is negative, or it is over an hour. */
export function commitGap(fromDate: string, toDate: string): string | null {
  const diff = new Date(toDate).getTime() - new Date(fromDate).getTime();
  if (!Number.isFinite(diff) || diff < 0 || diff > HOUR_MS) return null;
  return formatClock(diff);
}
