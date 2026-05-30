/**
 * Procedure trampoline — detects and executes procedure jobs.
 *
 * Some job cards contain a `<procedure ref="...">` element instead of
 * work for the agent. These are "trampolined" — the reactor detects
 * them, runs the procedure engine directly (no agent needed), and
 * finishes the job. This avoids wasting an agent session on what is
 * essentially a function call.
 */

import { parseCard, type ElementNode } from "cardworks";
import { startProcedure } from "../procedure/engine.js";
import { finishJob } from "../finish-job.js";
import { fmt } from "../../cli/lib/format.js";
import type { CommandContext } from "../command-runner.js";
import type { JobWithContent, ProcedureJobInfo } from "./types.js";

/**
 * Detect if a job card contains a `<procedure ref="...">` element.
 * If so, return the ref and optional directive text.
 */
export async function detectProcedureInJob(content: string, filePath: string): Promise<ProcedureJobInfo | null> {
  try {
    const root = await parseCard(content, { source: filePath });
    for (const child of root.children as ElementNode[]) {
      if (child.tagName === "procedure" && child.attrs["ref"]) {
        let directive: string | undefined;
        for (const grandchild of (child.children ?? []) as ElementNode[]) {
          if (grandchild.tagName === "directive") {
            directive = grandchild.text?.trim();
          }
        }
        return { procedureRef: child.attrs["ref"], ...(directive && { directive }) };
      }
    }
  } catch (_e) {
    // Expected for non-XML job cards: unparseable means "not a procedure job".
    // Detection probe, not an error path — fall through to return null.
  }
  return null;
}

interface ProcessProcedureJobsOptions {
  procedureJobs: JobWithContent[];
  boxRoot: string;
  dryRun: boolean;
  onLog?: ((text: string) => void) | undefined;
}

/**
 * Process procedure jobs by running the procedure engine directly.
 * Returns the number of successfully completed procedure jobs.
 */
export async function processProcedureJobs(opts: ProcessProcedureJobsOptions): Promise<number> {
  const { procedureJobs, boxRoot, dryRun, onLog } = opts;
  onLog?.(fmt.header(`\nProcessing ${procedureJobs.length} procedure job(s):\n`));

  const ctx: CommandContext = {
    boxRoot,
    write: (text: string) => onLog?.(text),
    writeLine: (text: string) => onLog?.(text + "\n"),
  };

  let completed = 0;

  for (const job of procedureJobs) {
    const info = job.procedureInfo!;
    onLog?.(`  ${fmt.strong(info.procedureRef)}${info.directive ? ` (directive: ${info.directive})` : ""}\n`);

    if (dryRun) {
      onLog?.(fmt.dim(`  [DRY RUN] Would run procedure: ${info.procedureRef}\n`));
      continue;
    }

    const result = await startProcedure({
      ctx,
      procedureNameOrPath: info.procedureRef,
      options: { ...(info.directive && { directive: info.directive }) },
    });

    if (result.success) {
      await finishJob({ boxRoot, jobRelPath: job.relPath });
      onLog?.(fmt.ok(`Finished procedure job: ${job.relPath}\n`));
      completed++;
    } else {
      onLog?.(fmt.fail(`Procedure failed for ${job.relPath}: ${result.error ?? "unknown"}\n`));
    }
  }

  return completed;
}
