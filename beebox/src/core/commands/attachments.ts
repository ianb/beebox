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

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import {
  registerCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import {
  type AssetManifest,
  computeEntry,
  loadManifest,
  saveManifest,
} from "../asset-manifest.js";
import { scanBoxAttachments } from "../asset-manifest-scan.js";
import {
  runInitGitignore,
  runUnignore,
  runUntrackAssets,
} from "./attachments-gitignore.js";
import { assetAnnexAttributes, assetLargefilesExpression } from "../../lib/asset-extensions.js";
import { describeUnlistedBinaries, findUnlistedBinaries } from "../annex/unlisted-binaries.js";
import { convertBoxToAnnex } from "../annex/to-annex.js";
import { createGitAnnexService } from "../../services/git-annex.js";
import { getBoxShape } from "../../lib/box-shape.js";

const AttachmentsArgsSchema = z.object({
  // Always supplied by the dispatch (CLI positional / API caller); an absent
  // subcommand fails validation rather than reaching the `default` arm.
  subcommand: z.string(),
  /** Path argument for overwrite / add. Relative to box root. */
  pathArg: z.string().optional(),
  /** When set, write to disk; otherwise dry-run. Used by verify. */
  apply: z.boolean().optional(),
});

async function executeAttachments(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { subcommand, pathArg, apply } = parseCommandArgs(args, AttachmentsArgsSchema);

  switch (subcommand) {
    case "verify":
      return runVerify(ctx);
    case "migrate":
      return runMigrate(ctx);
    case "overwrite":
      if (!pathArg) return { success: false, error: "overwrite requires a path" };
      return runOverwrite(ctx, pathArg);
    case "add":
      if (!pathArg) return { success: false, error: "add requires a path" };
      return runAdd(ctx, { relPath: pathArg, apply: apply !== false });
    case "untrack-assets":
      return runUntrackAssets(ctx);
    case "init-gitignore":
      return runInitGitignore(ctx);
    case "unignore":
      return runUnignore(ctx);
    case "to-annex":
      return runToAnnex(ctx, { dryRun: apply === false });
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
 * One-way migration onto git-annex.
 *
 * Errors propagate rather than becoming a failed CommandResult: every one of
 * them means the box is in a state where continuing would destroy the evidence
 * needed to detect a problem, and the stack trace is worth having.
 */
async function runToAnnex(ctx: CommandContext, opts: { dryRun: boolean }): Promise<CommandResult> {
  const shape = await getBoxShape(ctx.boxRoot);
  const result = await convertBoxToAnnex(createGitAnnexService(), {
    repoRoot: shape.boxRoot,
    boxRoot: ctx.boxRoot,
    options: { dryRun: opts.dryRun },
  });
  const mb = Math.round(result.bytes / (1024 * 1024));
  ctx.writeLine(
    result.dryRun
      ? `Would annex ${String(result.annexed)} asset(s) (${String(mb)} MB). Nothing changed.`
      : `Annexed ${String(result.annexed)} asset(s) (${String(mb)} MB); ` +
        `removed ${String(result.manifestsRemoved)} manifest(s).`,
  );
  return { success: true, data: { ...result } };
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

/**
 * Read-only scan. Exit success only when no errors were found. Quiet by
 * design: this runs on every commit via the pre-commit hook, so routine
 * states (unclaimed assets awaiting `migrate`, stale mtimes) are one summary
 * line, never per-scope output — only errors enumerate. (Per-scope detail was
 * once printed for everything; on a never-migrated box that was ~140 lines of
 * noise per commit.)
 */
async function runVerify(ctx: CommandContext): Promise<CommandResult> {
  const result = await scanBoxAttachments(ctx.boxRoot, { dryRun: true });
  let unclaimed = 0;
  let stale = 0;
  let renamed = 0;
  for (const scope of result.scopes) {
    unclaimed += scope.claimed.length;
    stale += scope.refreshed.length;
    renamed += scope.renamed.length;
  }
  if (result.errors.length > 0) {
    ctx.writeLine(`${result.errors.length} asset error(s):`);
    for (const err of result.errors) ctx.writeLine(`  ${err.message}`);
    return {
      success: false,
      error: `${result.errors.length} asset error(s)`,
      data: { scopes: result.scopes.length, errors: result.errors.length },
    };
  }
  const notes: string[] = [];
  if (unclaimed > 0) notes.push(`${unclaimed} unclaimed asset(s) — \`bbx attachments migrate\` claims them`);
  if (stale > 0) notes.push(`${stale} stale mtime(s)`);
  if (renamed > 0) notes.push(`${renamed} rename(s) detected`);
  const suffix = notes.length > 0 ? `; ${notes.join("; ")}` : "";
  ctx.writeLine(`OK: ${result.scopes.length} scope(s), no errors${suffix}.`);
  return {
    success: true,
    data: { scopes: result.scopes.length, errors: 0, unclaimed, stale, renamed },
  };
}

/**
 * Run the scan in write mode. The pre-commit hook will use the same
 * underlying scan; this command is how a user/agent kicks off the *first*
 * write of manifests across the box (the safe initial migration step before
 * binaries are gitignored).
 */
async function runMigrate(ctx: CommandContext): Promise<CommandResult> {
  const result = await scanBoxAttachments(ctx.boxRoot);
  let totalClaimed = 0;
  let totalRefreshed = 0;
  let totalRenamed = 0;
  for (const scope of result.scopes) {
    totalClaimed += scope.claimed.length;
    totalRefreshed += scope.refreshed.length;
    totalRenamed += scope.renamed.length;
    if (scope.manifestUpdated) {
      const parts: string[] = [];
      if (scope.claimed.length > 0) parts.push(`+${scope.claimed.length} claimed`);
      if (scope.refreshed.length > 0) parts.push(`${scope.refreshed.length} refreshed`);
      if (scope.renamed.length > 0) parts.push(`${scope.renamed.length} renamed`);
      ctx.writeLine(`  ${scope.attachDir}: ${parts.join(", ")}`);
    }
  }
  ctx.writeLine("");
  ctx.writeLine(
    `Migrate: ${result.scopes.length} scope(s) walked, ${totalClaimed} claimed, ${totalRefreshed} refreshed, ${totalRenamed} renamed.`
  );
  if (result.errors.length > 0) {
    ctx.writeLine("");
    ctx.writeLine(`${result.errors.length} error(s):`);
    for (const err of result.errors) ctx.writeLine(`  ${err.message}`);
    return {
      success: false,
      error: `${result.errors.length} asset error(s)`,
      data: { scopes: result.scopes.length, claimed: totalClaimed, errors: result.errors.length },
    };
  }
  return {
    success: true,
    data: { scopes: result.scopes.length, claimed: totalClaimed, refreshed: totalRefreshed },
  };
}

/**
 * Overwrite a tracked asset from stdin. The path must already be
 * manifested; new assets go through `add`.
 */
async function runOverwrite(ctx: CommandContext, relPath: string): Promise<CommandResult> {
  const absPath = path.resolve(ctx.boxRoot, relPath);
  const attachDir = path.dirname(absPath);
  const fileName = path.basename(absPath);

  if (!attachDir.endsWith(".attach")) {
    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
  }

  const manifest = await loadManifest(attachDir);
  if (!manifest.files[fileName]) {
    return { success: false, error: `${relPath} is not tracked in the manifest; use 'bbx attachments add' first` };
  }

  const stdin = await readStdin();
  if (stdin.length === 0) {
    return { success: false, error: "stdin was empty (use 'bbx attachments overwrite path - < file' or pipe content)" };
  }

  await writeAsset({ absPath, content: stdin });
  const entry = await computeEntry(absPath);
  manifest.files[fileName] = entry;
  await saveManifest(attachDir, manifest);

  ctx.writeLine(`Overwrote ${relPath} (${stdin.length} bytes, sha=${entry.sha256.slice(0, 12)}…)`);
  return { success: true, data: { path: relPath, size: stdin.length } };
}

/**
 * Explicitly claim an existing on-disk file. Mostly useful when the hook is
 * disabled or when scripting; normal flow is the pre-commit auto-claim.
 */
async function runAdd(
  ctx: CommandContext,
  { relPath, apply }: { relPath: string; apply: boolean }
): Promise<CommandResult> {
  const absPath = path.resolve(ctx.boxRoot, relPath);
  const attachDir = path.dirname(absPath);
  const fileName = path.basename(absPath);

  if (!attachDir.endsWith(".attach")) {
    return { success: false, error: `${relPath} is not inside an .attach/ directory` };
  }
  try {
    await fs.access(absPath);
  } catch (_e) {
    // fs.access rejects when the file is missing/unreadable — which is
    // exactly the case we report. The error carries no detail worth
    // surfacing beyond "does not exist", so we don't include it.
    return { success: false, error: `${relPath} does not exist` };
  }

  const manifest: AssetManifest = await loadManifest(attachDir);
  const entry = await computeEntry(absPath);
  const existing = manifest.files[fileName];
  if (existing && existing.sha256 === entry.sha256) {
    ctx.writeLine(`Already tracked with matching hash: ${relPath}`);
    return { success: true, data: { path: relPath, noop: true } };
  }
  manifest.files[fileName] = entry;
  if (apply) {
    await saveManifest(attachDir, manifest);
    // Belt and suspenders: enforce read-only on tracked files.
    await fs.chmod(absPath, 0o444);
  }
  ctx.writeLine(`Added ${relPath} (sha=${entry.sha256.slice(0, 12)}…)`);
  return { success: true, data: { path: relPath, sha256: entry.sha256 } };
}

/** Atomic write + chmod 444. Used by overwrite. */
async function writeAsset({ absPath, content }: { absPath: string; content: Buffer }): Promise<void> {
  // Best-effort chmod +w so we can overwrite a previously-locked file. Ignore
  // errors (file may not exist or filesystem may not support chmod).
  try { await fs.chmod(absPath, 0o644); } catch (_e) { /* ignore */ }
  const tmp = `${absPath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, absPath);
  try { await fs.chmod(absPath, 0o444); } catch (_e) { /* ignore */ }
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

registerCommand({
  name: "attachments",
  description: "Manifest-aware operations on assets (verify, migrate, overwrite, add)",
  args: [
    {
      name: "subcommand",
      description: "verify | migrate | overwrite | add",
      required: true,
      type: "string",
    },
    {
      name: "pathArg",
      description: "Box-relative path (for overwrite, add)",
      required: false,
      type: "string",
    },
  ],
  execute: executeAttachments,
});

