/**
 * cb status - Show current state summary
 */

import { Command } from "commander";
import { getSystemState, type CardInfo } from "../../core/state.js";
import { listParkedTemplateUpdates } from "../../core/install-template-file.js";
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

      // Template drift: stock templates whose upstream update is parked because
      // the box copy diverged (boxholder-edited, or a version not yet in the
      // template's priorStockHashes). Surfaced so drift doesn't stay invisible.
      const parkedTemplates = await listParkedTemplateUpdates(boxRoot);
      if (parkedTemplates.length > 0) {
        console.log(`Template updates: ${parkedTemplates.length} parked (in config/_template-updates/)`);
        if (options.verbose) {
          for (const relPath of parkedTemplates) {
            console.log(`  - ${relPath}`);
          }
          console.log("  Accept one by copying config/_template-updates/<path> over config/<path>, or discard the parked copy.");
        }
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
