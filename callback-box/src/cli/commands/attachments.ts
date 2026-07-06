/**
 * cb attachments — manifest-aware operations on assets (the binary
 * subset of attachments).
 *
 * Subcommands:
 *   cb attachments verify         # read-only scan, exit non-zero on errors
 *   cb attachments migrate        # write manifests for every asset in .attach/
 *   cb attachments overwrite PATH # replace tracked asset contents from stdin
 *   cb attachments add PATH       # explicitly claim a file (rarely needed;
 *                                   the pre-commit hook auto-claims)
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";

export const attachmentsCommand = new Command("attachments")
  .description("Manifest-aware operations on assets");

attachmentsCommand
  .command("verify")
  .description("Scan all .attach/ scopes; non-zero exit on errors. Read-only.")
  .action(async () => dispatch("verify"));

attachmentsCommand
  .command("migrate")
  .description("Write manifests for every asset in .attach/. Idempotent.")
  .action(async () => dispatch("migrate"));

attachmentsCommand
  .command("overwrite <path>")
  .description("Replace the contents of a tracked asset. Reads from stdin.")
  .action(async (relPath: string) => dispatch("overwrite", relPath));

attachmentsCommand
  .command("add <path>")
  .description("Explicitly claim an on-disk file into its manifest.")
  .action(async (relPath: string) => dispatch("add", relPath));

attachmentsCommand
  .command("untrack-assets")
  .description("Migration step: git rm --cached every asset covered by a manifest. Idempotent.")
  .action(async () => dispatch("untrack-assets"));

attachmentsCommand
  .command("init-gitignore")
  .description("Append the asset gitignore patterns to the box's .gitignore. Idempotent.")
  .action(async () => dispatch("init-gitignore"));

async function dispatch(subcommand: string, relPath?: string): Promise<void> {
  try {
    const boxRoot = await requireBoxRoot();
    const ctx = createCliContext(boxRoot);
    const args: Record<string, unknown> = { subcommand };
    if (relPath) args["pathArg"] = relPath;
    const result = await runCommand({ name: "attachments", args, ctx });
    if (!result.success) {
      if (result.error) console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}
