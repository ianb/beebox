/**
 * Render an ISO timestamp as a friendly, local-timezone date (the browser's
 * locale + zone). Emits a semantic <time> with the machine-readable ISO in
 * `dateTime`. `suppressHydrationWarning` because the server (SSR `cb render`)
 * formats in its own zone and the client re-formats in the user's — the text
 * is expected to differ between the two passes.
 *
 *   <FriendlyDate iso={card.captured} />            → "Jun 14, 2026, 10:36 AM"
 *   <FriendlyDate iso={card.captured} mode="date" /> → "Jun 14, 2026"
 */
interface FriendlyDateProps {
  iso: string;
  /** "datetime" (default) shows date + time; "date" shows the day only. */
  mode?: "datetime" | "date";
}

export function FriendlyDate({ iso, mode }: FriendlyDateProps) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    // Not a parseable timestamp — show the raw value rather than "Invalid Date".
    return <span>{iso}</span>;
  }
  const options: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { dateStyle: "medium" }
      : { dateStyle: "medium", timeStyle: "short" };
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {parsed.toLocaleString(undefined, options)}
    </time>
  );
}
