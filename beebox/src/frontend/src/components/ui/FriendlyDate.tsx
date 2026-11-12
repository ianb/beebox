/**
 * Render an ISO timestamp as a friendly, local-timezone date (the browser's
 * locale + zone). Emits a semantic <time> with the machine-readable ISO in
 * `dateTime`.
 *
 *   <FriendlyDate iso={card.captured} />            → "Jun 14, 2026, 10:36 AM"
 *   <FriendlyDate iso={card.captured} mode="date" /> → "Jun 14, 2026"
 *   <FriendlyDate iso={card.captured} mode="time" /> → "10:36 AM"
 *   <FriendlyDate iso="2026-08-14" />               → "Aug 14, 2026"
 */
import { parseIsoDate } from "@shared/todo-model";

export type FriendlyDateMode = "datetime" | "date" | "time";

interface FriendlyDateProps {
  iso: string;
  /**
   * "datetime" (default) shows date + time; "date" shows the day only; "time"
   * shows the time only (a date-only value has no time, so it shows the day).
   */
  mode?: FriendlyDateMode;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a value names: a calendar day or an instant, as epoch milliseconds. A
 * date-only string ("2026-08-14") is a day, with no time and no zone, kept as
 * its UTC midnight and always formatted in UTC; formatting it in the browser's
 * zone shows the previous day anywhere behind UTC, as a todo due `2026-08-14`
 * once showed "Aug 13, 2026" in the US. Anything else — an ISO timestamp,
 * epoch milliseconds, or another form `Date` reads, such as a timestamp with
 * no offset — is an instant, read as `Date` reads it.
 */
function parse(value: string | number): { kind: "day" | "instant"; epoch: number } | null {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    // null for a well-shaped string that names no day, such as "2026-02-30".
    const epoch = parseIsoDate(value);
    return epoch === null ? null : { kind: "day", epoch };
  }
  const epoch = new Date(value).getTime();
  return Number.isNaN(epoch) ? null : { kind: "instant", epoch };
}

/**
 * The text {@link FriendlyDate} shows, for places that need a string (titles,
 * sentences). Takes an ISO string or epoch milliseconds. A day is shown as
 * that day, never with a time; an instant in the browser's zone, with the time
 * unless `mode` is "date", and the time alone when `mode` is "time". A value
 * that does not parse comes back as written rather than "Invalid Date".
 */
export function friendlyDate(value: string | number, mode?: FriendlyDateMode): string {
  const parsed = parse(value);
  if (parsed === null) return String(value);
  const date = new Date(parsed.epoch);
  if (parsed.kind === "day") return date.toLocaleString(undefined, { dateStyle: "medium", timeZone: "UTC" });
  if (mode === "date") return date.toLocaleString(undefined, { dateStyle: "medium" });
  if (mode === "time") return date.toLocaleString(undefined, { timeStyle: "short" });
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FriendlyDate({ iso, mode }: FriendlyDateProps) {
  // Not a parseable date — show the raw value rather than "Invalid Date".
  if (parse(iso) === null) return <span>{iso}</span>;
  return <time dateTime={iso}>{friendlyDate(iso, mode)}</time>;
}
