/**
 * bbx finalize - Post-processing phase for outbound connectors.
 *
 * Symmetric counterpart to `bbx wakeup`. Runs after job processing
 * to flush outbound cards (e.g. telegram messages in box/output/).
 *
 * Called by the reactor after all job cycles complete, or manually.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import { createPushConnector } from "../../connectors/push.js";
import { checkPendingQuestionsAndNotify } from "../../core/question-alert.js";
import { ageQuestions } from "../../core/question-aging.js";
import { getAllConnectors } from "../../connectors/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const finalizeCommand = new Command("finalize")
  .description("Run outbound connectors (post-processing phase)")
  .option("-c, --connector <name>", "Only run specific connector")
  .action(async (options: { connector?: string }) => {
    const boxRoot = await requireBoxRoot();

    console.log("[Finalize: running outbound connectors]");

    // Notify the boxholder about newly-pending questions before the connectors
    // run, so the cards it writes get delivered in this same finalize pass.
    if (!options.connector || options.connector === "push") {
      try {
        const result = await checkPendingQuestionsAndNotify(boxRoot, { now: new Date() });
        if (result) console.log(`  Question alert: ${result.notified.length} new question(s)`);
      } catch (err) {
        console.error(`  Question alert failed: ${errorMessage(err)}`);
      }

      // Ages pending questions (nudge, then expire) regardless of whether
      // any notification channel is configured — the lifecycle transition
      // never depends on notifyChannels, only the nudge's delivery does.
      try {
        const aging = await ageQuestions(boxRoot);
        if (aging.nudged.length > 0 || aging.expired.length > 0) {
          console.log(
            `  Question aging: ${aging.nudged.length} nudged, ${aging.expired.length} expired`
          );
        }
      } catch (err) {
        console.error(`  Question aging failed: ${errorMessage(err)}`);
      }
    }

    // Initialize connectors
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);
    createTelegramConnector(boxRoot);
    createGoogleDriveConnector(boxRoot);
    createPushConnector(boxRoot);

    const connectors = getAllConnectors();

    if (connectors.length === 0) {
      console.log("  No connectors configured.");
      return;
    }

    const toRun = options.connector
      ? connectors.filter((c) => c.name === options.connector)
      : connectors;

    if (toRun.length === 0) {
      console.error(`Connector not found: ${options.connector}`);
      process.exit(1);
    }

    let totalPushed = 0;
    let totalErrors = 0;

    for (const connector of toRun) {
      connector.triggeredBy = "bbx finalize";
      console.log(`Syncing ${connector.name}...`);

      try {
        const result = await connector.sync();

        if (result.pushed && result.pushed.length > 0) {
          console.log(`  Pushed ${result.pushed.length} card(s):`);
          for (const card of result.pushed) {
            console.log(`    - ${card}`);
          }
          totalPushed += result.pushed.length;
        }

        if (result.error) {
          console.error(`  Error: ${result.error}`);
          totalErrors++;
        } else if (!result.pushed || result.pushed.length === 0) {
          console.log("  No outbound items.");
        }
      } catch (err) {
        console.error(`  Failed: ${errorMessage(err)}`);
        totalErrors++;
      }
    }

    console.log(`\nTotal: ${totalPushed} pushed, ${totalErrors} errors.`);
  });
