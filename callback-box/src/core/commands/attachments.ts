/**
 * cb attachments — manifest-aware operations on assets (the binary
 * subset of attachments). The command operates on the whole `.attach/`
 * scope (hence the name), but its job is the asset subset.
 *
 * Subcommands:
 *   - verify   : scan all .attach/ scopes, report errors, no writes
 *   - migrate  : claim every asset into its manifest (idempotent first run)
 *   - overwrite: replace contents of a tracked asset from stdin
 *   - add      : explicitly claim an untracked asset (rare; the hook
 *                normally auto-claims)
 *
 * Destructive ops (overwrite, rm, mv) re-implement the chmod 444 →
 * +w → atomic-rename → 444 dance so the manifest stays in sync.
 *
 * The gitignore subcommands (init-gitignore, untrack-assets) live in the
 * sibling attachments-gitignore.ts.
 *
 * See docs/asset-manifests.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
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
  runUntrackAssets,
} from "./attachments-gitignore.js";

interface AttachmentsArgs {
  subcommand: string;
  /** Path argument for overwrite / add. Relative to box root. */
  pathArg?: string;
  /** When set, write to disk; otherwise dry-run. Used by verify. */
  apply?: boolean;
}

async function executeAttachments(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { subcommand, pathArg, apply } = args as unknown as AttachmentsArgs;

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
    default:
      return { success: false, error: `Unknown subcommand: ${subcommand}` };
  }
}

/**
 * Read-only scan. Reports claimed/refreshed/renamed/errors but doesn't write
 * any manifests. Exit success only when no errors were found.
 */
async function runVerify(ctx: CommandContext): Promise<CommandResult> {
  const result = await scanBoxAttachments(ctx.boxRoot, { dryRun: true });
  for (const scope of result.scopes) {
    const parts: string[] = [];
    if (scope.claimed.length > 0) parts.push(`would claim ${scope.claimed.length}`);
    if (scope.refreshed.length > 0) parts.push(`would refresh mtime on ${scope.refreshed.length}`);
    if (scope.renamed.length > 0) parts.push(`renames ${scope.renamed.length}`);
    if (scope.unchanged.length > 0) parts.push(`${scope.unchanged.length} unchanged`);
    if (scope.errors.length > 0) parts.push(`${scope.errors.length} error(s)`);
    if (parts.length > 0) ctx.writeLine(`  ${scope.attachDir}: ${parts.join(", ")}`);
  }
  if (result.errors.length === 0) {
    ctx.writeLine(`OK: ${result.scopes.length} scope(s) clean.`);
    return { success: true, data: { scopes: result.scopes.length, errors: 0 } };
  }
  ctx.writeLine("");
  ctx.writeLine("Errors:");
  for (const err of result.errors) ctx.writeLine(`  ${err.message}`);
  return {
    success: false,
    error: `${result.errors.length} asset error(s)`,
    data: { scopes: result.scopes.length, errors: result.errors.length },
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
    return { success: false, error: `${relPath} is not tracked in the manifest; use 'cb attachments add' first` };
  }

  const stdin = await readStdin();
  if (stdin.length === 0) {
    return { success: false, error: "stdin was empty (use 'cb attachments overwrite path - < file' or pipe content)" };
  }

  await writeAsset({ absPath, content: stdin });
  manifest.files[fileName] = await computeEntry(absPath);
  await saveManifest(attachDir, manifest);

  ctx.writeLine(`Overwrote ${relPath} (${stdin.length} bytes, sha=${manifest.files[fileName]!.sha256.slice(0, 12)}…)`);
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

export { executeAttachments };
