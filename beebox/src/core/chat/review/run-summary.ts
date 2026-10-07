/**
 * The scheduled-run summary for a chat review pass (`core/schedule/summary.ts`):
 * what it reviewed and titled in the headline, the skips by reason in the
 * body, and the bookkeeping counts in the notes. Failures make the run
 * `attention`; skips are the ordinary state of a quiet night.
 */

import type { RunSummary as ScheduledRunSummary } from "../../schedule/summary.js";
import { TITLE_CHAR_THRESHOLD } from "./discovery.js";
import type { RunSummary } from "./run/core.js";

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** Count lines in the order the boxholder reads them; zero counts are left out. */
function lines(entries: Array<[number, string]>): string[] {
  return entries.filter(([count]) => count > 0).map(([count, label]) => `- ${label}: ${String(count)}`);
}

function skipLines(summary: RunSummary): string[] {
  return lines([
    [summary.belowTitleThreshold, `not enough new text for a title (under ${String(TITLE_CHAR_THRESHOLD)} characters)`],
    [summary.tooFewTurns, "too few user turns"],
    [summary.deferredActive, "still active in the last 30 minutes"],
    [summary.missingTranscripts, "transcript gone"],
    [summary.foreignOrigin, "started on another machine (reviewed there)"],
    [summary.exhausted, "given up after repeated failures"],
    [summary.overflow, "over this run's cap, left for the next run"],
  ]);
}

function problemLines(summary: RunSummary): string[] {
  return lines([
    [summary.reviewerFailures, "reviewer failures"],
    [summary.sessionErrors, "errors reading or writing a chat"],
  ]);
}

function noteLines(summary: RunSummary): string[] {
  const notes = lines([
    [summary.titlesKept, "titles kept by the freshness check"],
    [summary.alreadyApplied, "already applied"],
    [summary.bootstrapped, "read from the top"],
    [summary.rewritten, "transcripts rewritten since the last pass"],
  ]);
  for (const rejection of summary.rejected) notes.push(`- leak scan dropped ${rejection}`);
  return notes;
}

/** The run's summary for the schedule's run history. */
export function chatReviewRunSummary(summary: RunSummary): ScheduledRunSummary {
  const skips = skipLines(summary);
  const skipped = summary.belowTitleThreshold + summary.tooFewTurns + summary.deferredActive
    + summary.missingTranscripts + summary.foreignOrigin + summary.exhausted + summary.overflow;
  const problems = problemLines(summary);
  const did = [`Reviewed ${plural(summary.reviewed, "chat")}`, `titled ${String(summary.titled)}`];
  if (skipped > 0) did.push(`skipped ${String(skipped)}`);
  const headline = summary.reviewed === 0 && summary.titled === 0 && skipped === 0 && problems.length === 0
    ? "No chats to review"
    : did.join(", ");
  const bodySections = [
    ...(problems.length > 0 ? [`**Problems**\n${problems.join("\n")}`] : []),
    ...(skips.length > 0 ? [`**Skipped**\n${skips.join("\n")}`] : []),
  ];
  const notes = noteLines(summary);
  return {
    headline,
    priority: problems.length > 0 ? "attention" : "normal",
    ...(bodySections.length > 0 ? { body: bodySections.join("\n\n") } : {}),
    ...(notes.length > 0 ? { notes: notes.join("\n") } : {}),
  };
}
