/**
 * bbx run-summary — end a scheduled run with a summary the boxholder sees.
 *
 * Writes `{headline, body?, notes?, priority}` to `$BBX_SUMMARY_FILE`, which
 * the scheduler sets on every `runs:` command; a `bbx procedure run` passes it
 * on to its shells and agent steps. The dashboard shows it in the schedule's
 * run history (`core/schedule/summary.ts`). A later call in the same run
 * replaces an earlier one. Outside a scheduled run nothing is listening, so
 * the summary is printed instead.
 *
 * Stdin is read only for `--body -` or `--notes -`, never implicitly: a
 * schedule's pipeline can hold an open stdin pipe.
 *
 * Exit codes: 0 written (or printed); 2 a usage error.
 */

import { Command } from "commander";
import { RUN_PRIORITIES, normalizeRunSummary, reportRunSummary, type RunPriority, type RunSummary } from "../../core/schedule/summary.js";

interface RunSummaryOptions {
  priority: string;
  body?: string | undefined;
  notes?: string | undefined;
}

const PRIORITIES: ReadonlySet<string> = new Set(RUN_PRIORITIES);

function isPriority(value: string): value is RunPriority {
  return PRIORITIES.has(value);
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** The summary from the arguments, or a usage error message. */
async function summaryFromArgs(headline: string, options: RunSummaryOptions): Promise<RunSummary | string> {
  if (!isPriority(options.priority)) {
    return `--priority must be one of ${RUN_PRIORITIES.join(", ")}, got "${options.priority}"`;
  }
  if (options.body === "-" && options.notes === "-") return "only one of --body and --notes can read stdin";
  if (headline.trim() === "") return "the headline is empty";
  const stdin = options.body === "-" || options.notes === "-" ? await readAllStdin() : "";
  const body = options.body === "-" ? stdin : options.body;
  const notes = options.notes === "-" ? stdin : options.notes;
  return {
    headline,
    priority: options.priority,
    ...(body === undefined ? {} : { body }),
    ...(notes === undefined ? {} : { notes }),
  };
}

export const runSummaryCommand = new Command("run-summary")
  .description("End a scheduled run with a summary the boxholder sees in the dashboard")
  .argument("<headline>", "One line saying what the run did (up to 120 characters)")
  .option("--priority <priority>", "normal (the run went as usual) or attention (the boxholder should look)", "normal")
  .option("--body <markdown>", "A short Markdown body, up to 1 KB, or - to read it from stdin")
  .option("--notes <markdown>", "Longer Markdown detail, up to 4 KB, shown collapsed, or - to read it from stdin")
  .action(async (headline: string, options: RunSummaryOptions) => {
    const summary = await summaryFromArgs(headline, options);
    if (typeof summary === "string") {
      console.error(summary);
      process.exit(2);
    }
    const cut = await reportRunSummary(process.env, summary);
    if (cut === null) {
      const shown = normalizeRunSummary(summary).summary;
      console.log(`Not in a scheduled run; the summary would be:\n${JSON.stringify(shown, null, 2)}`);
      return;
    }
    for (const field of cut) console.warn(`run-summary: cut the ${field}`);
  });
