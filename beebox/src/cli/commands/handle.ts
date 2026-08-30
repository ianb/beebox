/**
 * bbx handle — Run handler procedures for triaged category buckets.
 *
 * Thin wrapper around the core handle command. See
 * `docs/triage.md` §Handle (stage 3).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";
import { readHandlingResults } from "../../core/handle.js";
import {
  INCONCLUSIVE_EXIT_CODE,
  formatHandleInconclusiveLine,
} from "../../shared/inconclusive.js";

/** Flush the diagnostic into scheduler pipes before terminating the CLI. */
async function writeStderr(line: string): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stderr.write(`${line}\n`, () => resolve());
  });
}

/**
 * Exit for the worst bucket in the pass. A handler whose work completed but
 * whose review reached no verdict gets the inconclusive exit code and one
 * stderr line per bucket — the same shape `bbx procedure run` prints, so the
 * scheduler classifies a scheduled `bbx handle` the same way either command
 * produced it. Exiting 0 here (what it used to do) told a caller gating on
 * success that the handling was checked when nothing checked it.
 */
async function exitForInconclusive(data: unknown): Promise<void> {
  const unjudged = readHandlingResults(data).filter(
    (r) => r.outcome === "procedure-inconclusive",
  );
  if (unjudged.length === 0) return;
  for (const bucket of unjudged) {
    await writeStderr(
      formatHandleInconclusiveLine({
        category: bucket.category,
        detail: bucket.detail ?? "the review reached no verdict",
      }),
    );
  }
  process.exit(INCONCLUSIVE_EXIT_CODE);
}

export const handleCommand = new Command("handle")
  .description("Run handler procedures for triaged category buckets.")
  .argument("[category]", "Only handle this category (defaults to all non-empty buckets)")
  .action(async (category: string | undefined) => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);
      const args: Record<string, unknown> = {};
      if (category) args["category"] = category;
      const result = await runCommand({ name: "handle", args, ctx });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      await exitForInconclusive(result.data);
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`);
      process.exit(1);
    }
  });
