/**
 * Wakeup command - Wake up and process pending items.
 *
 * This wraps the existing wakeup logic as a registered command.
 */

import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { runWakeup, type WakeupResult } from "../wakeup.js";
import { acquireLock, releaseLock, getLockInfo } from "../../cli/lib/lock.js";

/**
 * Arguments for the wakeup command.
 */
export interface WakeupArgs {
  /** Show what would happen without doing it */
  dryRun?: boolean;
  /** Force wakeup even if another process is running */
  force?: boolean;
}

/**
 * Execute the wakeup command.
 */
async function executeWakeup(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const wakeupArgs = args as WakeupArgs;

  // Check for existing lock
  if (!wakeupArgs.force) {
    const existingLock = await getLockInfo(ctx.boxRoot);
    if (existingLock) {
      return {
        success: false,
        error: `Another wakeup is running (PID ${existingLock.pid}, started ${existingLock.startedAt}). Use --force to override.`,
      };
    }
  }

  // Acquire lock
  const lock = await acquireLock(ctx.boxRoot);
  if (!lock && !wakeupArgs.force) {
    return {
      success: false,
      error: "Failed to acquire lock - another process may be running",
    };
  }

  let result: WakeupResult;
  try {
    ctx.writeLine("Wakeup started");
    ctx.writeLine("================");
    ctx.writeLine("");

    result = await runWakeup(ctx.boxRoot, {
      dryRun: wakeupArgs.dryRun,
      onLog: ctx.writeLine,
    });

    ctx.writeLine("================");
    if (result.success) {
      ctx.writeLine("Wakeup complete");
    } else {
      ctx.writeLine(`Wakeup failed: ${result.error}`);
    }
  } finally {
    // Always release lock
    await releaseLock(ctx.boxRoot);
  }

  if (result.success) {
    return {
      success: true,
      data: {
        phases: result.phases,
      },
    };
  } else {
    return {
      success: false,
      data: {
        phases: result.phases,
      },
      error: result.error ?? "Unknown error",
    };
  }
}

// Register the command
registerCommand({
  name: "wakeup",
  description: "Wake up and process pending items",
  args: [
    {
      name: "dryRun",
      description: "Show what would happen without doing it",
      required: false,
      default: false,
      type: "boolean",
    },
    {
      name: "force",
      description: "Force wakeup even if another process is running",
      required: false,
      default: false,
      type: "boolean",
    },
  ],
  execute: executeWakeup,
});

export { executeWakeup };
