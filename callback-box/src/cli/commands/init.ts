/**
 * cb init - Initialize a new callback box
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { initBox, installWorkflows } from "../../core/box.js";
import { generateRules } from "./init-rules.js";
import { generateDocs, setDocIdDebug } from "../../core/generate-docs.js";

export const initCommand = new Command("init")
  .description("Initialize or update a callback box")
  .argument("[path]", "Path to initialize", ".")
  .option("--skip-git", "Skip git initialization")
  .option("-b, --branch <name>", "Initial branch name", "main")
  .option("--docid-debug", "Add DOCID markers to generated docs (persists until --no-docid-debug)")
  .action(async (targetPath: string, options: { skipGit?: boolean; branch: string; docidDebug?: boolean }) => {
    try {
      const { isUpdate } = await initBox(targetPath, {
        skipGit: options.skipGit,
        branch: options.branch,
      });

      if (isUpdate) {
        console.log(`Updated callback box at ${resolve(targetPath)}`);
        console.log("  Ensured standard directories exist");
        console.log("  Updated .gitignore");
      } else {
        console.log(`Initialized callback box at ${targetPath}`);

        if (!options.skipGit) {
          console.log("Git repository initialized with initial commit.");
        }

        console.log("\nDirectory structure created:");
        console.log("  box/inbox/          - Incoming items");
        console.log("  box/inbox/unhandled - Items with no clear destination");
        console.log("  box/questions/      - Pending questions");
        console.log("  box/resources/      - Synced external state");
        console.log("  store/archive/      - Processed items");
        console.log("  store/integrated/   - Feedback absorbed into briefs");
        console.log("  store/trash/        - Soft-deleted items");
        console.log("  config/             - Configuration");
        console.log("  .claude/            - Agent configuration");
      }

      // Install workflow templates
      const workflows = await installWorkflows(resolve(targetPath));
      if (workflows.length > 0) {
        console.log(`\nInstalled ${workflows.length} workflow(s) in config/workflows/`);
        for (const w of workflows) {
          console.log(`  ${w}`);
        }
      }

      // Generate card-handling rules from schemas
      const generated = await generateRules(resolve(targetPath));
      if (generated.length > 0) {
        console.log(`\nGenerated ${generated.length} card rules in .claude/rules/`);
      }

      // Set or clear the docid-debug marker
      if (options.docidDebug !== undefined) {
        await setDocIdDebug(resolve(targetPath), options.docidDebug);
      }

      // Generate agent documentation (picks up docid-debug from marker file)
      await generateDocs(resolve(targetPath));
      console.log("Generated agent docs in .callback-box/ and docs/generated/");
      if (options.docidDebug) {
        console.log("  DOCID markers enabled (grep for DOCID: in prompt logs to verify inclusion)");
      }

      if (!isUpdate) {
        console.log("\nRun 'cb status' to see the current state.");
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
