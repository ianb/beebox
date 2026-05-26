/**
 * cb assemble-timeline — Assemble structured transcript from timing data and images.
 *
 * Thin wrapper around the core assemble-timeline command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const assembleTimelineCommand = new Command("assemble-timeline")
  .description("Assemble structured transcript from timing data and images")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand({
        name: "assemble-timeline",
        args: {},
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
  });
