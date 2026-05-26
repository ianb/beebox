/**
 * cb finalize - Post-processing phase for outbound connectors.
 *
 * Symmetric counterpart to `cb wakeup`. Runs after job processing
 * to flush outbound cards (e.g. telegram messages in box/output/).
 *
 * Called by the reactor after all job cycles complete, or manually.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createTelegramConnector } from "../../connectors/telegram.js";
import { getAllConnectors } from "../../connectors/index.js";

export const finalizeCommand = new Command("finalize")
  .description("Run outbound connectors (post-processing phase)")
  .option("-c, --connector <name>", "Only run specific connector")
  .action(async (options: { connector?: string }) => {
    const boxRoot = await requireBoxRoot();

    console.log("[Finalize: running outbound connectors]");

    // Initialize connectors
    createTelegramConnector(boxRoot);

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
      connector.triggeredBy = "cb finalize";
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
        console.error(`  Failed: ${(err as Error).message}`);
        totalErrors++;
      }
    }

    console.log(`\nTotal: ${totalPushed} pushed, ${totalErrors} errors.`);
  });
