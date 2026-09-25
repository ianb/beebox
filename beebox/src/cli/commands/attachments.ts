/**
 * bbx attachments — git-annex operations on a box's assets.
 *
 * Subcommands:
 *   bbx attachments unignore         # restore the un-ignore block so git-annex sees assets
 *   bbx attachments largefiles-expr  # print the annex.largefiles expression
 *   bbx attachments annex-attributes # print the scoped .git/info/attributes
 *   bbx attachments check-unlisted   # block unlisted large binaries, box-wide
 *
 * The manifest-scheme subcommands (verify, migrate, add, overwrite,
 * init-gitignore, untrack-assets, to-annex) are gone with the scheme itself.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { runCommand, createCliContext } from "../../core/commands/index.js";
import { errorMessage } from "../../lib/error-guards.js";

export const attachmentsCommand = new Command("attachments")
  .description("git-annex operations on a box's assets");







attachmentsCommand
  .command("unignore")
  .description("Remove the asset gitignore block so git-annex can see assets. Idempotent.")
  .action(async () => dispatch("unignore"));

attachmentsCommand
  .command("largefiles-expr")
  .description("Print the annex.largefiles expression for this box's asset extensions.")
  .action(async () => dispatch("largefiles-expr"));

attachmentsCommand
  .command("annex-attributes")
  .description("Print the scoped .git/info/attributes contents for this box's asset extensions.")
  .action(async () => dispatch("annex-attributes"));

attachmentsCommand
  .command("check-unlisted")
  .description("Block large attach-scope files git-annex is not configured to annex.")
  .action(async () => dispatch("check-unlisted"));


async function dispatch(subcommand: string): Promise<void> {
  try {
    const boxRoot = await requireBoxRoot();
    const ctx = createCliContext(boxRoot);
    const result = await runCommand({ name: "attachments", args: { subcommand }, ctx });
    if (!result.success) {
      if (result.error) console.error(`Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${errorMessage(error)}`);
    process.exit(1);
  }
}
