/**
 * Render an ISO timestamp as a friendly, local-timezone date (the browser's
 * locale + zone). Emits a semantic <time> with the machine-readable ISO in
 * `dateTime`.
 *
 *   <FriendlyDate iso={card.captured} />            → "Jun 14, 2026, 10:36 AM"
 *   <FriendlyDate iso={card.captured} mode="date" /> → "Jun 14, 2026"
 */
interface FriendlyDateProps {
  iso: string;
  /** "datetime" (default) shows date + time; "date" shows the day only. */
  mode?: "datetime" | "date";
}

/**
 * A date-only string ("2026-08-14") is a calendar day, not an instant: the
 * Date constructor parses it as UTC midnight, so formatting it in the
 * browser's zone shows the *previous* day anywhere behind UTC (a todo due
 * `2026-08-14` rendered as "Aug 13, 2026" in the US). Format such values in
 * UTC — and never with a time — so the day shown is the day written.
 */
export function formatOptions({ iso, mode }: FriendlyDateProps): Intl.DateTimeFormatOptions {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { dateStyle: "medium", timeZone: "UTC" };
  if (mode === "date") return { dateStyle: "medium" };
  return { dateStyle: "medium", timeStyle: "short" };
}

export function FriendlyDate({ iso, mode }: FriendlyDateProps) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    // Not a parseable timestamp — show the raw value rather than "Invalid Date".
    return <span>{iso}</span>;
  }
  const options = formatOptions({ iso, mode });
  return (
    <time dateTime={iso}>
      {parsed.toLocaleString(undefined, options)}
    </time>
  );
}
