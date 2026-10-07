import { formatAgo } from "./relative-time";

/**
 * The Properties "Changed" line for a card's newest commit: "3 days ago ·
 * Add porch quotes", with the commit's full date for the tooltip. The caller
 * passes `now` (null before the clock has been read, as `useNow` starts), so
 * the line is deterministic under test; without a clock, or with a date that
 * does not parse, the date is shown as written.
 */
export function lastChangeLine(commit: { date: string; subject: string }, now: number | null): { text: string; title: string } {
  const at = Date.parse(commit.date);
  const when = now === null || Number.isNaN(at) ? commit.date : formatAgo(now - at);
  return { text: `${when} · ${commit.subject}`, title: commit.date };
}
