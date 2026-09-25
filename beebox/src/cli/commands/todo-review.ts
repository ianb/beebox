/**
 * bbx engine todo-review — the two deterministic halves of the stock
 * `todo-review` procedure (`templates/procedures/todo-review.procedure.card`,
 * `docs/plans/todos-ui.md` Track 7).
 *
 *   bbx engine todo-review check          The precheck. Sweeps, queues a job
 *                                         if needed, prints the job path the
 *                                         agent is to process, exits
 *                                         CHECK_SKIP_CODE (75) when there is
 *                                         nothing to review.
 *   bbx engine todo-review verify [job]   The validate. Exits 1 listing every
 *                                         job item still open without a
 *                                         recheck 1-90 days out; retires a
 *                                         todo on its third unchanged recheck.
 *                                         `job` defaults to the last job
 *                                         `check` named.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { checkTodoReview } from "../../core/todo/review-check.js";
import { verifyTodoReview } from "../../core/todo/review-verify.js";
import { loadSweepState } from "../../core/todo/review-state.js";
import { formatTodoLocation } from "../../core/todo/collect-types.js";

const checkCommand = new Command("check")
  .description("Sweep open todos; print the todo-review job to process, or exit CHECK_SKIP when there is none")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await checkTodoReview(boxRoot);
    if (result.kind === "nothing") {
      console.log("No todos to review");
      process.exit(CHECK_SKIP_CODE);
    }
    const origin = result.queued ? "queued this run" : "pending from an earlier run";
    console.log(`Todo review job: ${result.jobPath} (${origin}, ${String(result.items.length)} todo(s))`);
  });

const verifyCommand = new Command("verify")
  .description("Check every item of a todo-review job ended with a status change or a recheck date 1-90 days out")
  .argument("[job]", "Box-relative job card path (default: the last job `check` named)")
  .action(async (job: string | undefined) => {
    const boxRoot = await requireBoxRoot();
    const jobPath = job ?? (await loadSweepState(boxRoot)).job?.path;
    if (jobPath === undefined) {
      console.error("No todo-review job to verify: run `bbx engine todo-review check` first");
      process.exit(1);
    }
    const result = await verifyTodoReview(boxRoot, jobPath);
    for (const item of result.retired) {
      console.log(`Stopped reviewing ${formatTodoLocation(item)}: ${item.text} (third recheck with no change)`);
    }
    if (result.unsettled.length === 0) {
      console.log(`Every item of ${jobPath} is settled`);
      return;
    }
    console.log(`${String(result.unsettled.length)} item(s) of ${jobPath} are not settled:`);
    for (const { item, reason } of result.unsettled) {
      console.log(`- ${formatTodoLocation(item)} "${item.text}": ${reason}`);
    }
    process.exit(1);
  });

export const todoReviewCommand = new Command("todo-review")
  .description("The todo-review procedure's precheck and validate steps")
  .addCommand(checkCommand)
  .addCommand(verifyCommand);
