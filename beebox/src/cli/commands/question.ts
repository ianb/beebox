/**
 * bbx question — CLI command group for question-card transitions.
 *
 * Subcommands:
 *   bbx question decide <path> --decision --reasoning --undo
 *                                 Record what the box decided in place of an answer
 *   bbx question reraise <path>   Ask a dismissed question again
 *
 * Thin wrappers around the core `question-decide` and `question-reraise` commands.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { runCommand, createCliContext } from "../../core/command-runner.js";
import { errorMessage } from "../../shared/error-guards.js";

async function runQuestionCommand(name: string, args: Record<string, unknown>): Promise<void> {
  try {
    const boxRoot = await requireBoxRoot();
    const result = await runCommand({ name, args, ctx: createCliContext(boxRoot) });
    if (!result.success) {
      console.error(`Error: ${result.error ?? "Unknown error"}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

export const questionCommand = new Command("question").description("Change a question card's state");

questionCommand
  .command("decide")
  .description("Record what the box decided in place of an answer (not the person's answer)")
  .argument("<question>", "Question card path (relative to box root)")
  .requiredOption("--decision <text>", "What the box decided")
  .requiredOption("--reasoning <text>", "Why the box decided it")
  .requiredOption("--undo <text>", "How to reverse it if the person answers differently")
  .action((question: string, options: { decision: string; reasoning: string; undo: string }) =>
    runQuestionCommand("question-decide", { question, ...options })
  );

questionCommand
  .command("reraise")
  .description("Ask a dismissed question again, as the newest question")
  .argument("<question>", "Question card path (relative to box root)")
  .action((question: string) => runQuestionCommand("question-reraise", { question }));
