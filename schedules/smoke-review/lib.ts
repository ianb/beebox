/**
 * The decisions the weekly smoke review makes before any agent is involved:
 * what window to look at, whether there is anything to look at, and how the
 * evidence is laid out for the session.
 *
 * Pure — run.ts owns the git calls and the file reads — so the "is there
 * anything to say" rule is unit tested rather than discovered at 03:00.
 */

import type { SmokeSummary } from "../../bin/smoke-lib.ts";

/** What `run.ts` persists between weeks. */
export interface Baseline {
  /** ISO timestamp of the previous review's window end. */
  reviewedAt: string;
  /** Runs the log held then, so "new since" needs no re-derivation. */
  runs: number;
}

/**
 * The stored baseline, validated rather than cast.
 *
 * A baseline that cannot be read as one is treated as absent: the review then
 * covers one cadence, which is the same conservative window a first run gets.
 * Refusing instead would wedge the schedule on a file only it writes.
 */
export function parseBaseline(text: string): Baseline | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e: unknown) {
    // Only this schedule writes the file, so a malformed one is a truncated
    // write, not a contract someone else broke. Note it and treat it as absent.
    process.stderr.write(`smoke-review: unreadable baseline (${String(e)}); reviewing one cadence.\n`);
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  const { reviewedAt, runs } = record;
  if (typeof reviewedAt !== "string" || typeof runs !== "number") return null;
  return { reviewedAt, runs };
}

export interface Landing {
  commit: string;
  subject: string;
}

export interface FiledIssue {
  /** Where it lives now, which is not always where it was filed. */
  path: string;
  title: string;
  /** Already closed — someone has explained it. */
  closed: boolean;
}

export interface Evidence {
  windowStart: string;
  windowEnd: string;
  /** Every run ever logged. */
  allTime: SmokeSummary;
  /** Only the runs inside the window. */
  window: SmokeSummary;
  /** Failures in the window, most recent first. */
  failures: Array<{ ts: string; step: string; message: string; commit: string }>;
  landings: Landing[];
  /** Bug issues added in the window — the gap half's raw material. */
  bugs: FiledIssue[];
}

/**
 * The hourly full-suite run's own issues, told apart from everything else.
 *
 * These are the sharpest evidence the gap half has: each one is a regression
 * that reached `main` and was caught after the fact by the only thing that
 * tests `main`. If a walk of the running app would have seen it, the gate had a
 * hole. An ordinary bug report is weaker evidence — it may have been there for
 * months, and nothing says it ever passed a gate.
 *
 * Matched on the title `schedules/full-suite/lib.ts` writes. A rename there
 * moves these rows into the "other" group rather than losing them, which is
 * why both groups are shown in full.
 */
export function partitionBugs(bugs: readonly FiledIssue[]): {
  regressions: FiledIssue[];
  others: FiledIssue[];
} {
  const regressions = bugs.filter((bug) => bug.title.startsWith("Full-suite red after"));
  const regressed = new Set(regressions.map((bug) => bug.path));
  return { regressions, others: bugs.filter((bug) => !regressed.has(bug.path)) };
}

/**
 * The window this review covers.
 *
 * From the last review to now, so a run missed for three weeks reviews three
 * weeks rather than pretending the gap did not happen — the same catch-up
 * semantics the scheduler itself has. With no baseline, one cadence back:
 * reviewing the entire history on first run would sweep in every bug ever
 * filed, and the gap half would be unreadable.
 */
export function windowStart(input: {
  baseline: Baseline | null;
  now: Date;
  cadenceDays: number;
}): string {
  if (input.baseline !== null) return input.baseline.reviewedAt;
  const start = new Date(input.now.getTime() - input.cadenceDays * 24 * 60 * 60 * 1000);
  return start.toISOString();
}

/**
 * Is there anything worth a session this week?
 *
 * Two independent triggers, because the review has two halves and either can
 * be the whole product: smoke runs to judge, or newly filed bugs to check the
 * walk against. A week with neither is a genuine no-op and exits silently —
 * a report nobody can act on is noise on a cadence.
 *
 * Note what is NOT a trigger: a red smoke run. A red is already an alert and
 * already blocked its landing; this schedule is about the tier's shape, not
 * about any one failure.
 */
export function hasSomethingToReview(evidence: Evidence): boolean {
  return evidence.window.runs > 0 || evidence.bugs.length > 0;
}

/** One issue row. `closed` is marked because it is evidence, not bookkeeping. */
function bugLine(bug: FiledIssue): string {
  return `- \`${bug.path}\`${bug.closed ? " *(closed)*" : ""} — ${bug.title}`;
}

function stepTable(summary: SmokeSummary): string[] {
  const lines = [
    `${"step".padEnd(14)}${"ran".padStart(6)}${"failed".padStart(8)}${"p50".padStart(8)}   last failure`,
  ];
  for (const step of summary.steps) {
    lines.push(
      step.id.padEnd(14) +
        String(step.ran).padStart(6) +
        String(step.failed).padStart(8) +
        `${step.medianSeconds.toFixed(1)}s`.padStart(8) +
        `   ${step.lastFailure ?? (step.ran === 0 ? "never ran" : "never failed")}`,
    );
  }
  return lines;
}

/**
 * The briefing handed to the session.
 *
 * Evidence and provenance only — no verdict, no ranking, no "consider
 * trimming". The script's job is to put the facts in front of the session; the
 * moment it starts characterising them it is doing the judgment it exists to
 * hand off, and it will be wrong at 03:00 with nobody watching.
 */
export function formatBriefing(evidence: Evidence): string {
  const lines: string[] = [
    `Window: ${evidence.windowStart} → ${evidence.windowEnd}`,
    "",
    `## Smoke steps, all time (${String(evidence.allTime.runs)} runs, ${String(evidence.allTime.red)} red)`,
    "",
    "```",
    ...stepTable(evidence.allTime),
    "```",
    "",
    `## Smoke steps, this window (${String(evidence.window.runs)} runs, ${String(evidence.window.red)} red)`,
    "",
    "```",
    ...stepTable(evidence.window),
    "```",
    "",
  ];

  lines.push(`## Failures in this window (${String(evidence.failures.length)})`, "");
  if (evidence.failures.length === 0) {
    lines.push("None.", "");
  } else {
    for (const failure of evidence.failures) {
      lines.push(`- \`${failure.ts}\` **${failure.step}** (${failure.commit.slice(0, 8)}): ${failure.message}`);
    }
    lines.push("");
  }

  lines.push(
    "## Coverage",
    "",
    `${String(evidence.landings.length)} landing${evidence.landings.length === 1 ? "" : "s"} on main` +
      ` in this window; ${String(evidence.window.runs)} smoke run${evidence.window.runs === 1 ? "" : "s"} logged.`,
    "",
    "These two numbers are not directly joinable — the walk runs on the worktree",
    "branch before the merge, so its commit is never the merge commit — and not",
    "every landing is code-related, so not every landing should have run it. Read",
    "them as an order-of-magnitude check: far fewer runs than code landings means",
    "the gate is not running when it should be, which is worth more than any",
    "question about an individual step.",
    "",
  );

  const { regressions, others } = partitionBugs(evidence.bugs);
  lines.push(
    `## Regressions the hourly full-suite run caught on main (${String(regressions.length)})`,
    "",
    "The sharpest evidence for the gap half: each one reached `main` and was",
    "found after the fact. Would a walk of the running app have seen it first?",
    "",
    ...(regressions.length === 0
      ? ["None.", ""]
      : [...regressions.map(bugLine), ""]),
    `## Other bug issues filed in this window (${String(others.length)})`,
    "",
    "Weaker evidence — most will predate any gate, or be invisible to a browser",
    "walk. Skim for the ones a running app would have shown.",
    "",
    ...(others.length === 0
      ? ["None.", ""]
      : [...others.map(bugLine), ""]),
  );

  return lines.join("\n");
}
