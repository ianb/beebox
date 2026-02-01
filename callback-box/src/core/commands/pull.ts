/**
 * Pull command - Pull data from connectors.
 *
 * This is the core logic shared by both CLI and web API.
 */

import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { createRssConnector } from "../../connectors/rss.js";
import { getAllConnectors } from "../../connectors/index.js";

/**
 * Arguments for the pull command.
 */
export interface PullArgs {
  /** Only run specific connector */
  connector?: string;
}

/**
 * Execute the pull command.
 */
async function executePull(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const pullArgs = args as unknown as PullArgs;

  // Initialize connectors
  createRssConnector(ctx.boxRoot);

  const connectors = getAllConnectors();

  if (connectors.length === 0) {
    ctx.writeLine("No connectors configured.");
    return { success: true, data: { created: 0, errors: 0 } };
  }

  // Filter by name if specified
  const toRun = pullArgs.connector
    ? connectors.filter((c) => c.name === pullArgs.connector)
    : connectors;

  if (toRun.length === 0) {
    return {
      success: false,
      error: `Connector not found: ${pullArgs.connector}`,
    };
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const connector of toRun) {
    ctx.writeLine(`Pulling from ${connector.name}...`);

    try {
      const result = await connector.pull();

      if (result.created.length > 0) {
        ctx.writeLine(`  Created ${result.created.length} card(s):`);
        for (const card of result.created) {
          ctx.writeLine(`    - ${card}`);
        }
        totalCreated += result.created.length;
      }

      if (result.updated.length > 0) {
        ctx.writeLine(`  Updated ${result.updated.length} card(s)`);
      }

      if (result.error) {
        ctx.writeLine(`  Error: ${result.error}`);
        totalErrors++;
      } else if (result.created.length === 0 && result.updated.length === 0) {
        ctx.writeLine("  No new items.");
      }
    } catch (err) {
      ctx.writeLine(`  Failed: ${(err as Error).message}`);
      totalErrors++;
    }
  }

  ctx.writeLine(`\nTotal: ${totalCreated} created, ${totalErrors} errors.`);

  return {
    success: totalErrors === 0,
    data: { created: totalCreated, errors: totalErrors },
  };
}

// Register the command
registerCommand({
  name: "pull",
  description: "Pull data from connectors",
  args: [
    {
      name: "connector",
      description: "Only run specific connector",
      required: false,
      type: "string",
    },
  ],
  execute: executePull,
});

export { executePull };
