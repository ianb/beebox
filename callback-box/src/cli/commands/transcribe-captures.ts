/**
 * cb transcribe-captures — Transcribe audio in capture sessions.
 *
 * Thin wrapper around the core transcribe-captures command.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const transcribeCapturesCommand = new Command("transcribe-captures")
  .description("Transcribe audio in capture sessions with word-level timestamps")
  .action(async () => {
    try {
      const boxRoot = await requireBoxRoot();
      const ctx = createCliContext(boxRoot);

      const result = await runCommand("transcribe-captures", {}, ctx);

      if (!result.success) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
