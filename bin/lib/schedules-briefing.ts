/**
 * The text a scheduled agent session starts from: the run's handoff, the log
 * tail of a failed run, and how to file the report.
 */

import { PRIORITY_GUIDE, type Handoff, type Outcome } from "./schedules.js";
import type { ParkedWork } from "./schedules-branch.js";

/** How many log lines an alert carries as details. */
export const LOG_TAIL_LINES = 40;

/**
 * The run id is in the TEXT, not only the environment, so a session that lost
 * its environment — a later `resume` in a Terminal tab, an agent that shelled
 * out through something that scrubbed it — can still file its report.
 */
interface BriefingInput {
  name: string;
  runId: string;
  handoff: Handoff | null;
  logTail: string;
  outcome: Outcome;
  logFile: string;
  stateDir: string;
  /** What earlier runs left on this worktree's branch; null for a session in
   *  the main checkout. */
  inherited: Inherited | null;
  /** The run whose stored handoff this run replays, or null. */
  replayOf: string | null;
}

export interface Inherited {
  parked: ParkedWork | null;
  /** `<short-sha> <subject>` per commit on the branch and not on `main`. */
  unlanded: string[];
}

/**
 * A scheduled session is `claude -p` / `codex exec`: it ends when the agent
 * ends its turn, and nothing resumes it. The 2026-09 knip-sweep runs ended
 * their turn "waiting on the full suite" and lost the work. Background tasks
 * are also switched off in the agent command (`launch-headless.sh`); this text
 * covers what that cannot (a shell `&`, codex).
 */
const SINGLE_SHOT = [
  "This session is single-shot: it ends for good when you end your turn, and nothing resumes it.",
  "Run long commands (the test suite, typecheck) in the foreground with a timeout long enough to",
  "finish, never in the background, and never end your turn to wait for something. Before you end",
  "it, commit what your instructions let you commit, then file the report below.",
].join("\n");

function inheritedSection(inherited: Inherited): string | null {
  const parts: string[] = [];
  if (inherited.parked !== null) {
    const { parked } = inherited;
    parts.push([
      `An earlier run left ${String(parked.paths.length)} uncommitted path(s) in this worktree. The runner saved them as`,
      `commit \`${parked.sha.slice(0, 12)}\` (ref \`${parked.ref}\`, on top of \`${parked.base.slice(0, 12)}\`), then reset the`,
      "tree and merged `main`. Look with `git show --stat " + parked.ref + "`; take them back with",
      "`git merge --squash " + parked.ref + "` (staged, not committed; resolve any conflict with `main`).",
      "Finish, commit, or leave them, under the same authority your instructions give your own work, and",
      "say in your report which you chose. Do not delete the ref.",
    ].join("\n"));
  }
  if (inherited.unlanded.length > 0) {
    parts.push([
      `This branch carries ${String(inherited.unlanded.length)} commit(s) from earlier runs that are not on \`main\`:`,
      "",
      ...inherited.unlanded.map((line) => `- ${line}`),
      "",
      "If your instructions let you land your own work, verify and land these with it on the same terms.",
      "If they do not, leave them, and list them in your report so a person can.",
    ].join("\n"));
  }
  return parts.length === 0 ? null : `# What earlier runs left on this branch\n\n${parts.join("\n\n")}`;
}

export function briefingFor(input: BriefingInput): string {
  const parts: string[] = [];
  if (input.handoff !== null) parts.push(`# ${input.handoff.title}\n\n${input.handoff.body}`);
  if (input.replayOf !== null) {
    parts.push(`This is a replay of run \`${input.replayOf}\`'s handoff: that run's session ended without finishing it.`);
  }
  if (input.outcome === "failed") {
    parts.push(
      `# The \`${input.name}\` run failed\n\nIts last ${String(LOG_TAIL_LINES)} log lines:\n\n\`\`\`\n${input.logTail}\n\`\`\``,
    );
  }
  const inherited = input.inherited === null ? null : inheritedSection(input.inherited);
  if (inherited !== null) parts.push(inherited);
  parts.push(
    [
      "---",
      "",
      SINGLE_SHOT,
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
