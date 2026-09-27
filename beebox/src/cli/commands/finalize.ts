/**
 * bbx finalize - Post-processing phase for outbound connectors.
 *
 * Symmetric counterpart to `bbx wakeup`. Runs after job processing
 * to flush outbound cards (e.g. telegram messages in box/output/).
 *
 * Called by the reactor after all job cycles complete, or manually.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { createGoogleDriveConnector } from "../../connectors/google-drive.js";
import { checkPendingQuestionsAndNotify } from "../../core/question-alert.js";
import { ageQuestions } from "../../core/question-aging.js";
import { rotateIfNeeded } from "../../core/notification/log.js";
import { getBoxTime } from "../../lib/time.js";
import { getAllConnectors } from "../../connectors/index.js";
import { errorMessage } from "../../lib/error-guards.js";
import { syncConnector } from "../../connectors/activity.js";
import type { TelegramService } from "../../services/telegram.js";
import type { PushService } from "../../services/push.js";

/**
 * Age pending questions (nudge, then expire), then notify about the ones
 * newly pending. Aging runs first so a question about to expire is never
 * announced: an old box's first finalize would otherwise send a notice for
 * questions it expires a moment later. Aging never depends on a notification
 * channel; only the nudge's delivery does. `tg`/`push` are injected in tests.
 */
export async function finalizeQuestions(boxRoot: string, services: { tg?: TelegramService; push?: PushService }): Promise<void> {
  try {
    const aging = await ageQuestions(boxRoot, services);
    if (aging.nudged.length > 0 || aging.expired.length > 0) {
      console.log(`  Question aging: ${aging.nudged.length} nudged, ${aging.expired.length} expired`);
    }
  } catch (err) {
    console.error(`  Question aging failed: ${errorMessage(err)}`);
  }
  try {
    const result = await checkPendingQuestionsAndNotify(boxRoot, { now: getBoxTime(boxRoot), ...services });
    if (result) console.log(`  Question alert: ${result.notified.length} new question(s)`);
  } catch (err) {
    console.error(`  Question alert failed: ${errorMessage(err)}`);
  }
}

export const finalizeCommand = new Command("finalize")
  .description("Run outbound connectors (post-processing phase)")
  .option("-c, --connector <name>", "Only run specific connector")
  .action(async (options: { connector?: string }) => {
    const boxRoot = await requireBoxRoot();

    console.log("[Finalize: running outbound connectors]");

    if (!options.connector) {
      await finalizeQuestions(boxRoot, {});
      // Rotate the notification log at 30 days or 8 MB (log.ts owns the rule).
      try {
        if (await rotateIfNeeded(boxRoot, { now: getBoxTime(boxRoot) })) console.log("  Notification log rotated");
      } catch (err) {
        console.error(`  Notification log rotation failed: ${errorMessage(err)}`);
      }
    }

    // Initialize connectors
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);
    createTelegramConnector(boxRoot);
    createGoogleDriveConnector(boxRoot);

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
        const result = await syncConnector(connector, { boxRoot });

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
        } else if (result.skipped) {
          console.log(`  skipped (${result.skipped.reason}): ${result.skipped.detail}`);
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
