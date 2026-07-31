/**
 * cb attachments — manifest-aware operations on assets (the binary
 * subset of attachments).
 *
 * Subcommands:
 *   cb attachments verify         # read-only scan, exit non-zero on errors
 *   cb attachments migrate        # write manifests for every asset in .attach/
 *   cb attachments overwrite PATH # replace tracked asset contents from stdin
 *   cb attachments unignore       # drop the asset gitignore block (annex migration)
 *   cb attachments to-annex       # migrate this box onto git-annex
 *   cb attachments check-unlisted # block unlisted large binaries (pre-commit)
 *   cb attachments add PATH       # explicitly claim a file (rarely needed;
 *                                   the pre-commit hook auto-claims)
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

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
  .action(async (relPath: string) => dispatch("overwrite", { relPath }));

attachmentsCommand
  .command("add <path>")
  .description("Explicitly claim an on-disk file into its manifest.")
  .action(async (relPath: string) => dispatch("add", { relPath }));

attachmentsCommand
  .command("untrack-assets")
  .description("Migration step: git rm --cached every asset covered by a manifest. Idempotent.")
  .action(async () => dispatch("untrack-assets"));

attachmentsCommand
  .command("init-gitignore")
  .description("Append the asset gitignore patterns to the box's .gitignore. Idempotent.")
  .action(async () => dispatch("init-gitignore"));

attachmentsCommand
  .command("unignore")
  .description("Remove the asset gitignore block so git-annex can see assets. Idempotent.")
  .action(async () => dispatch("unignore"));

attachmentsCommand
  .command("largefiles-expr")
  .description("Print the annex.largefiles expression for this box's asset extensions.")
  .action(async () => dispatch("largefiles-expr"));

attachmentsCommand
  .command("check-unlisted")
  .description("Block large attach-scope files git-annex is not configured to annex.")
  .action(async () => dispatch("check-unlisted"));

attachmentsCommand
  .command("to-annex")
  .description("Migrate this box from asset manifests to git-annex. Verifies before and after.")
  .option("--dry-run", "Report what would happen; change nothing")
  .action(async (opts: { dryRun?: boolean }) =>
    dispatch("to-annex", { apply: opts.dryRun === true ? false : undefined }),
  );

interface DispatchOptions {
  /** Path argument for overwrite / add. */
  relPath?: string | undefined;
  /** false selects a dry run for to-annex. */
  apply?: boolean | undefined;
}

async function dispatch(subcommand: string, opts?: DispatchOptions): Promise<void> {
  const relPath = opts?.relPath;
  try {
    const boxRoot = await requireBoxRoot();
    const ctx = createCliContext(boxRoot);
    const args: Record<string, unknown> = { subcommand };
    if (relPath) args["pathArg"] = relPath;
    if (opts?.apply !== undefined) args["apply"] = opts.apply;
    const result = await runCommand({ name: "attachments", args, ctx });
    if (!result.success) {
      if (result.error) console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exit(1);
  }
}
