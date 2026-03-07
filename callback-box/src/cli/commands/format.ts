/**
 * cb format - Normalize card files to flat XML format (no indentation).
 */

import { Command } from "commander";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { requireBoxRoot, isCardFile } from "../lib/paths.js";
import { createLoader } from "../lib/loader.js";

export const formatCommand = new Command("format")
  .description("Normalize card files to flat XML format")
  .argument("[path]", "Path to format (file or directory)")
  .option("--all", "Format all cards in the box")
  .option("--dry-run", "Show which files would change without writing")
  .action(
    async (
      targetPath: string | undefined,
      options: { all?: boolean; dryRun?: boolean }
    ) => {
      try {
        const boxRoot = await requireBoxRoot();
        const loader = await createLoader(boxRoot);

        let paths: string[];

        if (options.all || !targetPath) {
          paths = await loader.listCards();
        } else {
          const fullPath = path.isAbsolute(targetPath)
            ? targetPath
            : path.join(process.cwd(), targetPath);

          if (!isCardFile(fullPath)) {
            console.error("Error: Path must be a card file (*.card)");
            process.exit(1);
          }

          paths = [fullPath];
        }

        let changed = 0;
        let unchanged = 0;
        let errors = 0;

        for (const cardPath of paths) {
          try {
            const original = await fs.readFile(cardPath, "utf-8");
            const card = await loader.load(cardPath);
            const formatted = loader.serialize(card.element);

            if (original.trim() !== formatted.trim()) {
              changed++;
              const rel = path.relative(boxRoot, cardPath);
              if (options.dryRun) {
                console.log(`would format: ${rel}`);
              } else {
                await loader.save(card);
                console.log(`formatted: ${rel}`);
              }
            } else {
              unchanged++;
            }
          } catch (e) {
            errors++;
            const rel = path.relative(boxRoot, cardPath);
            console.error(`error: ${rel}: ${(e as Error).message}`);
          }
        }

        console.log();
        const verb = options.dryRun ? "would change" : "formatted";
        console.log(
          `${changed} ${verb}, ${unchanged} already flat, ${errors} error(s)`
        );
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        process.exit(1);
      }
    }
  );
