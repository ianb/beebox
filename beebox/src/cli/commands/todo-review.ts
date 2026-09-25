/**
 * bbx engine todo-review — the two deterministic halves of the stock
 * `todo-review` procedure (`templates/procedures/todo-review.procedure.card`,
 * `docs/plans/todos-ui.md` Track 7).
 *
 *   bbx engine todo-review check    The precheck. Sweeps, saves the items,
 *                                   and prints the brief the agent works
 *                                   from (instructions + items); exits
 *                                   CHECK_SKIP_CODE (75) when there is
 *                                   nothing to review. Writes no job card.
 *   bbx engine todo-review verify   The validate. Exits 1 listing every
 *                                   saved item not settled; retires a todo
 *                                   on its third unchanged recheck.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { checkTodoReview } from "../../core/todo/review-check.js";
import { verifyTodoReview } from "../../core/todo/review-verify.js";
import { formatTodoLocation } from "../../core/todo/collect-types.js";

const checkCommand = new Command("check")
  .description("Sweep open todos and print the todo-review brief, or exit CHECK_SKIP when there is nothing to review")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await checkTodoReview(boxRoot);
    if (result.kind === "nothing") {
      console.log("No todos to review");
      process.exit(CHECK_SKIP_CODE);
    }
    console.log(result.brief);
  });

const verifyCommand = new Command("verify")
  .description("Check every item of the last todo review ended with a status change or a recheck date 1-90 days out")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await verifyTodoReview(boxRoot);
    for (const item of result.retired) {
      console.log(`Stopped reviewing ${formatTodoLocation(item)}: ${item.text} (third recheck with no change)`);
    }
    if (result.unsettled.length === 0) {
      console.log("Every todo review item is settled");
      return;
    }
    console.log(`${String(result.unsettled.length)} todo review item(s) are not settled:`);
    for (const { item, reason } of result.unsettled) {
      console.log(`- ${formatTodoLocation(item)} "${item.text}": ${reason}`);
    }
    process.exit(1);
  });

export const todoReviewCommand = new Command("todo-review")
  .description("The todo-review procedure's precheck and validate steps")
  .addCommand(checkCommand)
  .addCommand(verifyCommand);
