/**
 * Connector sync command - Sync data with connectors.
 *
 * This is a lightweight command that only runs connector sync.
 * The full wakeup flow (preprocessing, feedback-triage, reactor inbox jobs, etc.)
 * lives in src/cli/commands/wakeup.ts. Distinct from `cb triage` (the
 * triage-pipeline stage; see docs/triage.md).
 */

import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getAllConnectors } from "../../connectors/index.js";

/**
 * Arguments for the sync command.
 */
const SyncArgsSchema = z.object({
  /** Only run specific connector */
  connector: z.string().optional(),
});
export type SyncArgs = z.infer<typeof SyncArgsSchema>;

/**
 * Execute the sync command.
 */
async function executeSync(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const syncArgs = parseCommandArgs(args, SyncArgsSchema);

  const connectors = getAllConnectors();

  if (connectors.length === 0) {
    ctx.writeLine("No connectors configured.");
    return { success: true, data: { created: 0, errors: 0 } };
  }

  // Filter by name if specified
  const toRun = syncArgs.connector
    ? connectors.filter((c) => c.name === syncArgs.connector)
    : connectors;

  if (toRun.length === 0) {
    return {
      success: false,
      error: `Connector not found: ${syncArgs.connector}`,
    };
  }

  let totalCreated = 0;
  let totalErrors = 0;

  for (const connector of toRun) {
    ctx.writeLine(`Syncing ${connector.name}...`);

    try {
      const result = await connector.sync();

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
  name: "connector-sync",
  description: "Sync data with connectors",
  args: [
    {
      name: "connector",
      description: "Only run specific connector",
      required: false,
      type: "string",
    },
  ],
  execute: executeSync,
});

export { executeSync };
