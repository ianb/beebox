/**
 * cb status - Show current state summary
 */

import { Command } from "commander";
import { getSystemState, type CardInfo } from "../../core/state.js";
import { requireBoxRoot } from "../lib/paths.js";

export const statusCommand = new Command("status")
  .description("Show current state summary")
  .option("-v, --verbose", "Show more details")
  .action(async (options: { verbose?: boolean }) => {
    try {
      const boxRoot = await requireBoxRoot();
      const state = await getSystemState(boxRoot);

      // Header
      console.log(`Callback Box: ${boxRoot}`);
      console.log(`Version: ${state.boxVersion}`);
      console.log();

      // Git status
      if (state.git.clean) {
        console.log("Git: clean");
      } else {
        console.log("Git: uncommitted changes");
        if (options.verbose) {
          if (state.git.staged.length > 0) {
            console.log(`  Staged: ${state.git.staged.length}`);
          }
          if (state.git.modified.length > 0) {
            console.log(`  Modified: ${state.git.modified.length}`);
          }
          if (state.git.untracked.length > 0) {
            console.log(`  Untracked: ${state.git.untracked.length}`);
          }
        }
      }
      console.log();

      // Inbox
      console.log(`Inbox: ${state.inbox.length} item(s)`);
      if (state.inbox.length > 0 && options.verbose) {
        printCards(state.inbox);
      }

      // Questions
      const pending = state.questions.filter(q => q.status === "pending");
      const answered = state.questions.filter(q => q.status === "answered");
      console.log(`Questions: ${pending.length} pending, ${answered.length} answered`);
      if (pending.length > 0 && options.verbose) {
        printCards(pending);
      }

      // Commands
      const ready = state.commands.filter(c => c.status === "ready");
      console.log(`Commands: ${state.commands.length} total, ${ready.length} ready`);
      if (state.commands.length > 0 && options.verbose) {
        printCards(state.commands);
      }

      // Recent activity
      if (options.verbose && state.recentActivity.length > 0) {
        console.log();
        console.log("Recent activity:");
        for (const entry of state.recentActivity.slice(0, 5)) {
          const date = new Date(entry.date).toLocaleString();
          console.log(`  ${date}: ${entry.subject}`);
        }
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });

function printCards(cards: CardInfo[]): void {
  for (const card of cards) {
    const status = card.status ? ` [${card.status}]` : "";
    console.log(`  - ${card.relativePath}${status}`);
  }
}
