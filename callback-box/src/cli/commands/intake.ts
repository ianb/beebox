/**
 * cb intake — Run one pass of the intake stage.
 *
 * Thin wrapper around the core intake command. See
 * `docs/triage-design.md` for the surrounding pipeline.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const intakeCommand = new Command("intake")
  .description(
    "Run one intake pass: route fresh inbox items, normalize filenames, advance intake-complete items to staged.",
  )
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);
      const result = await runCommand({ name: "intake", args: {}, ctx });
      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
