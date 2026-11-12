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
 * What a value names: a calendar day or an instant. A date-only string
 * ("2026-08-14") is a day, with no time and no zone; reading it as an instant
 * (UTC midnight) shows the previous day anywhere behind UTC, as a todo due
 * `2026-08-14` once showed "Aug 13, 2026" in the US. Anything else — an ISO
 * timestamp, epoch milliseconds, or another form `Date` reads, such as a
 * timestamp with no offset — is an instant, read as `Date` reads it.
 */
function parse(value: string | number): Temporal.PlainDate | Temporal.Instant | null {
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    try {
      return Temporal.PlainDate.from(value);
    } catch (e) {
      // A well-shaped string that names no day, such as "2026-02-30".
      if (e instanceof RangeError) return null;
      throw e;
    }
  }
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : Temporal.Instant.fromEpochMilliseconds(ms);
}

/**
 * The text {@link FriendlyDate} shows, for places that need a string (titles,
 * sentences). Takes an ISO string or epoch milliseconds. A day is shown as
 * that day, never with a time; an instant in the browser's zone, with the time
 * unless `mode` is "date", and the time alone when `mode` is "time". A value that does not parse comes back as written
 * rather than "Invalid Date".
 */
export function friendlyDate(value: string | number, mode?: FriendlyDateMode): string {
  const parsed = parse(value);
  if (parsed === null) return String(value);
  if (parsed instanceof Temporal.PlainDate || mode === "date") return parsed.toLocaleString(undefined, { dateStyle: "medium" });
  if (mode === "time") return parsed.toLocaleString(undefined, { timeStyle: "short" });
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FriendlyDate({ iso, mode }: FriendlyDateProps) {
  // Not a parseable date — show the raw value rather than "Invalid Date".
  if (parse(iso) === null) return <span>{iso}</span>;
  return <time dateTime={iso}>{friendlyDate(iso, mode)}</time>;
}
