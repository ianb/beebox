/**
 * cb answer - Answer a pending question from CLI
 *
 * Thin wrapper around the core answer command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

/**
 * Handler for answer command
 */
async function handleAnswerCommand(
  params: { questionPath: string; answerText: string; via: string }
): Promise<void> {
  try {
    const boxRoot = await requireBoxRoot();
    const ctx = createCliContext(boxRoot);

    const result = await runCommand({
      name: "answer",
      args: {
        question: params.questionPath,
        answer: params.answerText,
        via: params.via,
      },
      ctx,
    });

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

/**
 * Action wrapper to handle the 3-parameter handler
 */
function actionWrapper(...args: [string, string, { via: string }]): Promise<void> {
  const [questionPath, answerText, options] = args;
  return handleAnswerCommand({ questionPath, answerText, via: options.via });
}

export const answerCommand = new Command("answer")
  .description("Answer a pending question")
  .argument("<question>", "Question card path (relative to box root)")
  .argument("<answer>", "Answer text or option ID (a, b, c, etc.)")
  .option("--via <source>", "Answer source", "cli")
  .action(actionWrapper);
