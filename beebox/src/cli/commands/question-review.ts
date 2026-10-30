/**
 * bbx engine question-review — the two deterministic halves of the stock
 * `question-review` procedure (`templates/procedures/question-review.procedure.card`).
 *
 *   bbx engine question-review check    The precheck. Prints the brief the agent
 *                                       works from; exits CHECK_SKIP_CODE (75)
 *                                       when no question needs review.
 *   bbx engine question-review verify   The validate. Exits 1 listing every
 *                                       listed question still put away with no
 *                                       decision; latches the rest.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { checkQuestionReview } from "../../core/question-review/check/core.js";
import { verifyQuestionReview } from "../../core/question-review/verify.js";

const checkCommand = new Command("check")
  .description("Print the question-review brief, or exit CHECK_SKIP when no question needs review")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await checkQuestionReview(boxRoot);
    if (result.kind === "nothing") {
      console.log("No questions to review");
      process.exit(CHECK_SKIP_CODE);
    }
    console.log(result.brief);
  });

const verifyCommand = new Command("verify")
  .description("Check every question of the last review ended decided or asked again")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await verifyQuestionReview(boxRoot);
    if (result.unsettled.length === 0) {
      console.log("Every question review item is settled");
      return;
    }
    console.log(`${String(result.unsettled.length)} question(s) are not settled:`);
    for (const { path, reason } of result.unsettled) {
      console.log(`- ${path}: ${reason}`);
    }
    process.exit(1);
  });

export const questionReviewCommand = new Command("question-review")
  .description("The question-review procedure's precheck and validate steps")
  .addCommand(checkCommand)
  .addCommand(verifyCommand);
