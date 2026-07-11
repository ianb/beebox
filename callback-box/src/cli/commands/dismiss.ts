/**
 * cb dismiss - Dismiss a pending question from CLI
 *
 * Thin wrapper around the core dismiss command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

/**
 * Handler for dismiss command
 */
async function handleDismissCommand(params: { questionPath: string }): Promise<void> {
  try {
    const boxRoot = await requireBoxRoot();
    const ctx = createCliContext(boxRoot);

    const result = await runCommand({
      name: "dismiss",
      args: { question: params.questionPath },
      ctx,
    });

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

export const dismissCommand = new Command("dismiss")
  .description("Dismiss a pending question")
  .argument("<question>", "Question card path (relative to box root)")
  .action((questionPath: string) => handleDismissCommand({ questionPath }));
