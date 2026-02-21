/**
 * cb sync - Sync data with connectors.
 *
 * Runs connectors to sync external data (pull + push).
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { createRssConnector } from "../../connectors/rss.js";
import { createDropboxConnector } from "../../connectors/dropbox.js";
import { createRaindropConnector } from "../../connectors/raindrop.js";
import { createCaptureConnector } from "../../connectors/capture.js";
import { createGmailConnector } from "../../connectors/gmail.js";
import { createGoogleCalendarConnector } from "../../connectors/google-calendar.js";
import { getAllConnectors } from "../../connectors/index.js";

export const syncCommand = new Command("sync")
  .description("Sync data with connectors")
  .option("-c, --connector <name>", "Only run specific connector")
  .action(async (options: { connector?: string }) => {
    const boxRoot = await requireBoxRoot();

    // Initialize connectors
    createRssConnector(boxRoot);
    createDropboxConnector(boxRoot);
    createRaindropConnector(boxRoot);
    createCaptureConnector(boxRoot);
    createGmailConnector(boxRoot);
    createGoogleCalendarConnector(boxRoot);

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
    let totalPushed = 0;
    let totalJobs = 0;
    let totalErrors = 0;

    for (const connector of toRun) {
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

        if (result.created.length > 0) {
          console.log(`  Created ${result.created.length} card(s):`);
          for (const card of result.created) {
            console.log(`    - ${card}`);
          }
          totalCreated += result.created.length;
        }

        if (result.jobs && result.jobs.length > 0) {
          console.log(`  Jobs created: ${result.jobs.length}`);
          for (const job of result.jobs) {
            console.log(`    - ${job}`);
          }
          totalJobs += result.jobs.length;
        }

        if (result.updated.length > 0) {
          console.log(`  Updated ${result.updated.length} card(s)`);
        }

        if (result.error) {
          console.error(`  Error: ${result.error}`);
          totalErrors++;
        } else if (
          result.created.length === 0 &&
          result.updated.length === 0 &&
          (!result.pushed || result.pushed.length === 0)
        ) {
          console.log("  No new items.");
        }
      } catch (err) {
        console.error(`  Failed: ${(err as Error).message}`);
        totalErrors++;
      }
    }

    const parts: string[] = [];
    if (totalPushed > 0) parts.push(`${totalPushed} pushed`);
    parts.push(`${totalCreated} created`);
    if (totalJobs > 0) parts.push(`${totalJobs} jobs`);
    parts.push(`${totalErrors} errors`);
    console.log(`\nTotal: ${parts.join(", ")}.`);
  });
