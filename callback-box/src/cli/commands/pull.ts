/**
 * cb pull - Pull data from connectors.
 *
 * Runs connectors to fetch external data and create cards.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createRssConnector } from "../../connectors/rss.js";
import { createDropboxConnector } from "../../connectors/dropbox.js";
import { getAllConnectors } from "../../connectors/index.js";

export const pullCommand = new Command("pull")
  .description("Pull data from connectors")
  .option("-c, --connector <name>", "Only run specific connector")
  .action(async (options: { connector?: string }) => {
    const boxRoot = await requireBoxRoot();

    // Initialize connectors
    createRssConnector(boxRoot);
    createDropboxConnector(boxRoot);

    const connectors = getAllConnectors();

    if (connectors.length === 0) {
      console.log("No connectors configured.");
      return;
    }

    // Filter by name if specified
    const toRun = options.connector
      ? connectors.filter((c) => c.name === options.connector)
      : connectors;

    if (toRun.length === 0) {
      console.error(`Connector not found: ${options.connector}`);
      process.exit(1);
    }

    let totalCreated = 0;
    let totalErrors = 0;

    for (const connector of toRun) {
      console.log(`Pulling from ${connector.name}...`);

      try {
        const result = await connector.pull();

        if (result.created.length > 0) {
          console.log(`  Created ${result.created.length} card(s):`);
          for (const card of result.created) {
            console.log(`    - ${card}`);
          }
          totalCreated += result.created.length;
        }

        if (result.updated.length > 0) {
          console.log(`  Updated ${result.updated.length} card(s)`);
        }

        if (result.error) {
          console.error(`  Error: ${result.error}`);
          totalErrors++;
        } else if (result.created.length === 0 && result.updated.length === 0) {
          console.log("  No new items.");
        }
      } catch (err) {
        console.error(`  Failed: ${(err as Error).message}`);
        totalErrors++;
      }
    }

    console.log(`\nTotal: ${totalCreated} created, ${totalErrors} errors.`);
  });
