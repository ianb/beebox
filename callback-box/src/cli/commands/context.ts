/**
 * cb context - Show current context for agents
 */

import { Command } from "commander";
import { generateContext } from "../../core/state.js";
import { requireBoxRoot } from "../lib/paths.js";

export const contextCommand = new Command("context")
  .description("Show current context for agents")
  .option("--json", "Output as JSON")
  .action(async (options: { json?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const context = await generateContext(boxRoot);

      if (options.json) {
        console.log(JSON.stringify(context, null, 2));
        return;
      }

      // Human-readable output
      console.log("Current State");
      console.log("=============");
      console.log();
      console.log(context.summary);
      console.log();

      if (context.pendingQuestions.length > 0) {
        console.log("Pending Questions:");
        for (const q of context.pendingQuestions) {
          console.log(`  [${q.path}]`);
          console.log(`    ${q.prompt}`);
          if (q.options) {
            for (const opt of q.options) {
              console.log(`      - ${opt}`);
            }
          }
          console.log();
        }
      }

      if (context.inboxCount > 0) {
        console.log(`Inbox: ${context.inboxCount} item(s) waiting to be processed`);
      }

      if (context.commandCount > 0) {
        console.log(`Commands: ${context.commandCount} command(s) pending`);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
