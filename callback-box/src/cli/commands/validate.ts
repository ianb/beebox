/**
 * cb validate - Validate cards against schemas
 */

import { Command } from "commander";
import * as path from "node:path";
import { lintAll, lintCards, formatLintResults, type LintSummary } from "cardworks";
import { requireBoxRoot, isCardFile } from "../lib/paths.js";
import { createLoader } from "../lib/loader.js";
import { getStatus } from "../lib/git.js";

export const validateCommand = new Command("validate")
  .description("Validate cards against schemas")
  .argument("[path]", "Path to validate (file or directory)")
  .option("--all", "Validate all cards in the box")
  .option("--json", "Output results as JSON")
  .option("--committed", "Also check that git working tree is clean")
  .action(
    async (
      targetPath: string | undefined,
      options: { all?: boolean; json?: boolean; committed?: boolean }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const loader = createLoader(boxRoot);

        let summary: LintSummary;

        if (options.all || !targetPath) {
          // Validate all cards
          summary = await lintAll(loader);
        } else {
          // Validate specific path
          const fullPath = path.isAbsolute(targetPath)
            ? targetPath
            : path.join(process.cwd(), targetPath);

          if (!isCardFile(fullPath)) {
            console.error("Error: Path must be a card file (*.card)");
            process.exit(1);
          }

          // Use lintCards for consistency with the summary format
          summary = await lintCards(loader, [fullPath]);
        }

        // Output results
        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          const output = formatLintResults(summary, { colors: true });
          if (output) {
            console.log(output);
          }

          // Summary
          console.log();
          console.log(
            `Validated ${summary.filesChecked} card(s): ` +
            `${summary.filesChecked - summary.filesWithErrors} valid, ` +
            `${summary.filesWithErrors} with issues`
          );
        }

        // Check git cleanliness if --committed
        if (options.committed) {
          const status = await getStatus(boxRoot);
          if (!status.clean) {
            const dirty = [...status.staged, ...status.modified, ...status.untracked];
            console.error("\nGit working tree is not clean:");
            for (const file of dirty) {
              console.error(`  ${file}`);
            }
            process.exit(1);
          }
          if (!options.json) {
            console.log("Git working tree is clean.");
          }
        }

        // Exit with error if any errors
        if (summary.totalErrors > 0) {
          process.exit(1);
        }
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );
