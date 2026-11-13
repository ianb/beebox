/**
 * bbx engine intentions — the two deterministic halves of the stock
 * `refresh-intentions` procedure
 * (`templates/procedures/refresh-intentions.procedure.card`,
 * `docs/implemented-plans/place-intention.md` Track D).
 *
 *   bbx engine intentions check    The precheck. Lists the places whose
 *                                  intention needs a look, saves the run, and
 *                                  prints the brief; exits CHECK_SKIP_CODE
 *                                  (75) when no place changed since its last
 *                                  review.
 *   bbx engine intentions verify   The validate. Exits 1 naming every
 *                                  out-of-scope change; otherwise records
 *                                  each listed place as reviewed.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { CHECK_SKIP_CODE } from "../../core/procedure/shell.js";
import { checkIntentions } from "../../core/intention-review/check/core.js";
import { verifyIntentions } from "../../core/intention-review/verify/core.js";

const checkCommand = new Command("check")
  .description("Print the brief of places whose intention needs review, or exit CHECK_SKIP when none changed")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await checkIntentions(boxRoot);
    if (result.kind === "nothing") {
      console.log("No place changed since its last intention review");
      process.exit(CHECK_SKIP_CODE);
    }
    console.log(result.brief);
  });

const verifyCommand = new Command("verify")
  .description("Check the review's commits changed only listed landmarks' intentions, then record the review")
  .action(async () => {
    const boxRoot = await requireBoxRoot();
    const result = await verifyIntentions(boxRoot);
    if (result.ok) {
      console.log(`Recorded the intention review of ${String(result.reviewed.length)} place(s)`);
      return;
    }
    console.log("Not recording this intention review; the next run lists these places again:");
    for (const problem of result.problems) console.log(`- ${problem}`);
    process.exit(1);
  });

export const intentionsCommand = new Command("intentions")
  .description("The refresh-intentions procedure's precheck and validate steps")
  .addCommand(checkCommand)
  .addCommand(verifyCommand);
