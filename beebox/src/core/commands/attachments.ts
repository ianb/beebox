/**
 * bbx attachments — manifest-aware operations on assets (the binary
 * subset of attachments). The command operates on the whole `.attach/`
 * scope (hence the name), but its job is the asset subset.
 *
 * Subcommands:
 *   - verify   : scan all .attach/ scopes, report errors, no writes
 *   - migrate  : claim every asset into its manifest (idempotent first run)
 *   - overwrite: replace contents of a tracked asset from stdin
 *   - add      : explicitly claim an untracked asset (rare; the hook
 *                normally auto-claims)
 *   - unignore : drop the asset ignore block so git-annex can see assets
 *                (git-annex migration; see docs/plans/asset-annex.md)
 *   - largefiles-expr : print the annex.largefiles expression
 *   - annex-attributes: print the scoped .git/info/attributes contents
 *   - check-unlisted  : block on large attach-scope files git-annex won't annex
 *   - to-annex        : one-way migration onto git-annex (verifies before and
 *                       after; see core/annex/to-annex.ts)
 *
 * Destructive ops (overwrite, rm, mv) re-implement the chmod 444 →
 * +w → atomic-rename → 444 dance so the manifest stays in sync.
 *
 * The gitignore subcommands (init-gitignore, untrack-assets) live in the
 * sibling attachments-gitignore.ts.
 *
 * See docs/implemented-plans/asset-manifests.md.
 */

import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { runUnignore } from "./attachments-gitignore.js";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../lib/asset-extensions.js";
import { describeUnlistedBinaries, findUnlistedBinaries } from "../annex/unlisted-binaries.js";

const AttachmentsArgsSchema = z.object({
  // Always supplied by the dispatch (CLI positional / API caller); an absent
  // subcommand fails validation rather than reaching the `default` arm.
  subcommand: z.string(),
});

async function executeAttachments(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { subcommand } = parseCommandArgs(args, AttachmentsArgsSchema);

  switch (subcommand) {
    case "unignore":
      return runUnignore(ctx);
    case "check-unlisted":
      return runCheckUnlisted(ctx);
    case "largefiles-expr":
      // Printed so the migration can feed it straight to
      // `git annex config --set annex.largefiles "$(...)"`, keeping one
      // definition of what an asset is rather than a hand-copied string.
      ctx.writeLine(assetLargefilesExpression());
      return { success: true, data: { expression: assetLargefilesExpression() } };
    case "annex-attributes":
      // The `.git/info/attributes` counterpart, for `bbx attachments
      // annex-attributes > .git/info/attributes` when repairing by hand.
      // `assetAnnexAttributes()` ends in a newline and writeLine adds another;
      // trailing blank lines in an attributes file are ignored by git, but the
      // doctor compares exactly, so the trailing one is trimmed here.
      ctx.writeLine(assetAnnexAttributes().trimEnd());
      return { success: true, data: { attributes: assetAnnexAttributes() } };
    default:
      return { success: false, error: `Unknown subcommand: ${subcommand}` };
  }
}


/**
 * Report large unannexed bytes sitting in attach scopes, box-wide.
 *
 * The commit path no longer runs this: the pre-commit hook checks the *staged
 * blobs* instead (`core/annex/staged-unlisted.ts`), which fires at exactly the
 * commit that would embed the bytes rather than re-walking the tree. This walk
 * stays as the on-demand sweep, alongside `bbx doctor annex`.
 *
 * The allowlist's failure mode is omission, and it has failed that way before:
 * `page.frozen` snapshots reached box history because nothing noticed a new
 * binary type matching no pattern. Advisory output would have been ignored the
 * same way, so this exits non-zero.
 */
async function runCheckUnlisted(ctx: CommandContext): Promise<CommandResult> {
  const found = await findUnlistedBinaries(ctx.boxRoot);
  if (found.length === 0) return { success: true, data: { unlisted: 0 } };
  ctx.writeLine(describeUnlistedBinaries(found));
  return {
    success: false,
    error: `${found.length} large file(s) in attach scopes would be committed as raw bytes`,
    data: { unlisted: found.length },
  };
}

registerCommand({
  name: "attachments",
  description: "git-annex operations on a box's assets",
  args: [
    {
      name: "subcommand",
      description: "unignore | check-unlisted | largefiles-expr | annex-attributes",
      required: true,
      type: "string",
    },
  ],
  execute: executeAttachments,
});
