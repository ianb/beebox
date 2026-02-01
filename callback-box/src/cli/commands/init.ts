/**
 * cb init - Initialize a new callback box
 */

import { Command } from "commander";
import { initBox } from "../../core/box.js";

export const initCommand = new Command("init")
  .description("Initialize a new callback box")
  .argument("[path]", "Path to initialize", ".")
  .option("--skip-git", "Skip git initialization")
  .option("-b, --branch <name>", "Initial branch name", "main")
  .action(async (targetPath: string, options: { skipGit?: boolean; branch: string }) => {
    try {
      await initBox(targetPath, {
        skipGit: options.skipGit,
        branch: options.branch,
      });

      console.log(`Initialized callback box at ${targetPath}`);

      if (!options.skipGit) {
        console.log("Git repository initialized with initial commit.");
      }

      console.log("\nDirectory structure created:");
      console.log("  box/inbox/       - Incoming items");
      console.log("  box/commands/    - Commands ready to execute");
      console.log("  box/questions/   - Pending questions");
      console.log("  box/resources/   - Synced external state");
      console.log("  store/archive/   - Processed items");
      console.log("  store/trash/     - Soft-deleted items");
      console.log("  config/          - Configuration");
      console.log("  .claude/         - Agent configuration");
      console.log("\nRun 'cb status' to see the current state.");
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
