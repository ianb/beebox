/**
 * The text a scheduled agent session starts from: the run's handoff, the log
 * tail of a failed run, and how to file the report.
 */

import { PRIORITY_GUIDE, type Handoff, type Outcome } from "./schedules.js";

/** How many log lines an alert carries as details. */
export const LOG_TAIL_LINES = 40;

/**
 * The run id is in the TEXT, not only the environment, so a session that lost
 * its environment — a later `resume` in a Terminal tab, an agent that shelled
 * out through something that scrubbed it — can still file its report.
 */
interface BriefingInput { name: string; runId: string; handoff: Handoff | null; logTail: string; outcome: Outcome; logFile: string; stateDir: string }

export function briefingFor(input: BriefingInput): string {
  const parts: string[] = [];
  if (input.handoff !== null) parts.push(`# ${input.handoff.title}\n\n${input.handoff.body}`);
  if (input.outcome === "failed") {
    parts.push(
      `# The \`${input.name}\` run failed\n\nIts last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${input.logTail}\n\`\`\``,
    );
  }
  parts.push(
    [
      "---",
      "",
      `You are running as scheduled run \`${input.runId}\` of the \`${input.name}\` schedule.`,
      "",
      // Without these paths an agent went looking with `find ~`, which walks
      // iCloud Drive, Music, and Photos and raises macOS privacy prompts.
      `This run's full log is \`${input.logFile}\`. Everything the schedule keeps between runs is in`,
      `\`${input.stateDir}\` (also \`$SCHEDULE_STATE_DIR\`). Never search the home directory for them.`,
      "",
      "Finish by filing your report — a run whose session ends without one is recorded as bailed:",
      "",
      `    bin/schedules alert --run ${input.runId} --title "<one line>" --message "<Markdown: the finding, then a list>" \\`,
      `        [--details @<file>] [--priority important|normal|fyi]\n\n${PRIORITY_GUIDE}`,
      "",
      "or, when there is nothing worth saying:",
      "",
      `    bin/schedules done --run ${input.runId}`,
      "",
    ].join("\n"),
  );
  return `${parts.join("\n\n")}\n`;
}
