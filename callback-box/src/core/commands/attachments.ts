/**
 * cb attachments — manifest-aware operations on binary attachments.
 *
 * Subcommands:
 *   - verify   : scan all .attach/ scopes, report errors, no writes
 *   - migrate  : claim every binary into its manifest (idempotent first run)
 *   - overwrite: replace contents of a tracked attachment from stdin
 *   - add      : explicitly claim an untracked binary (rare; the hook
 *                normally auto-claims)
 *
 * Destructive ops (overwrite, rm, mv) re-implement the chmod 444 →
 * +w → atomic-rename → 444 dance so the manifest stays in sync.
 *
 * See docs/attach-manifests.md.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  registerCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import {
  type AttachManifest,
  computeEntry,
  loadManifest,
  saveManifest,
} from "../attach-manifest.js";
import { scanBoxAttachments } from "../attach-manifest-scan.js";

const execFileAsync = promisify(execFile);

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
    case "untrack-binaries":
      return runUntrackBinaries(ctx);
    default:
      return { success: false, error: `Unknown subcommand: ${subcommand}` };
  }
}

/**
 * Migration step: ask git which currently-tracked files would now be ignored
 * by the box's `.gitignore`, and `git rm --cached` them. Working-tree files
 * stay (they're on disk and the manifests reference them); only the git
 * index drops them. Pre-existing history still carries the blobs, but
 * future commits will not.
 *
 * Idempotent: a second run finds no tracked-but-ignored files and is a no-op.
 *
 * Refuses to run if the manifests don't cover everything we're about to
 * untrack — running this before `cb attachments migrate` would lose the
 * inventory.
 */
async function runUntrackBinaries(ctx: CommandContext): Promise<CommandResult> {
  // List tracked files that the current .gitignore would ignore. `git
  // ls-files -i --exclude-standard -c` does exactly that: tracked-but-now-
  // ignored.
  let stdout: string;
  try {
    const res = await execFileAsync(
      "git",
      ["ls-files", "-z", "-i", "-c", "--exclude-standard"],
      { cwd: ctx.boxRoot, maxBuffer: 64 * 1024 * 1024 }
    );
    stdout = res.stdout;
  } catch (e) {
    return { success: false, error: `git ls-files failed: ${(e as Error).message}` };
  }
  const trackedIgnored = stdout
    .split("\0")
    .filter((s) => s.length > 0);
  if (trackedIgnored.length === 0) {
    ctx.writeLine("Nothing to untrack — no currently-tracked files match the gitignore.");
    return { success: true, data: { untracked: 0 } };
  }

  // Safety check: every file we're about to untrack must be either covered
  // by an attach manifest (so we can verify integrity later) or be a non-
  // attach file (in which case the user is doing something we don't know
  // about — refuse). Files outside .attach/ scopes aren't our concern; we
  // only handle attachment binaries here.
  const inAttach: string[] = [];
  const outsideAttach: string[] = [];
  for (const relPath of trackedIgnored) {
    if (relPath.includes(".attach/")) inAttach.push(relPath);
    else outsideAttach.push(relPath);
  }
  if (outsideAttach.length > 0) {
    ctx.writeLine(`Skipping ${outsideAttach.length} file(s) outside .attach/ scopes (gitignored for other reasons):`);
    for (const p of outsideAttach.slice(0, 5)) ctx.writeLine(`  ${p}`);
    if (outsideAttach.length > 5) ctx.writeLine(`  ...and ${outsideAttach.length - 5} more`);
  }
  if (inAttach.length === 0) {
    ctx.writeLine("No tracked attachment binaries to untrack.");
    return { success: true, data: { untracked: 0 } };
  }

  // Verify each file is covered by its enclosing attach scope's manifest.
  // A binary at `msg-001.attach/attachments/foo.png` belongs to
  // `msg-001.attach/manifest.json` under key `attachments/foo.png`.
  const uncovered: string[] = [];
  const manifestCache = new Map<string, AttachManifest>();
  for (const relPath of inAttach) {
    const scope = enclosingAttachScope(relPath);
    if (!scope) {
      uncovered.push(relPath);
      continue;
    }
    const scopeAbs = path.join(ctx.boxRoot, scope);
    let manifest = manifestCache.get(scopeAbs);
    if (!manifest) {
      try { manifest = await loadManifest(scopeAbs); }
      catch { manifest = { files: {} }; }
      manifestCache.set(scopeAbs, manifest);
    }
    const scopeRel = relPath.slice(scope.length + 1);  // strip "<scope>/"
    if (!manifest.files[scopeRel]) uncovered.push(relPath);
  }
  if (uncovered.length > 0) {
    ctx.writeLine(`Refusing to untrack: ${uncovered.length} file(s) are not covered by a manifest.`);
    ctx.writeLine("Run 'cb attachments migrate' first so every binary is tracked.");
    for (const p of uncovered.slice(0, 5)) ctx.writeLine(`  ${p}`);
    if (uncovered.length > 5) ctx.writeLine(`  ...and ${uncovered.length - 5} more`);
    return {
      success: false,
      error: `${uncovered.length} attachment(s) not in manifest`,
    };
  }

  // git rm --cached --quiet -- <files>. Chunk to avoid argv overflow.
  const CHUNK = 100;
  for (let i = 0; i < inAttach.length; i += CHUNK) {
    const slice = inAttach.slice(i, i + CHUNK);
    await execFileAsync("git", ["rm", "--cached", "--quiet", "--", ...slice], {
      cwd: ctx.boxRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  ctx.writeLine(`Untracked ${inAttach.length} attachment binary file(s) from the git index.`);
  ctx.writeLine("Working-tree files are preserved. Manifests cover them. Commit to finalize.");
  return { success: true, data: { untracked: inAttach.length } };
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
    error: `${result.errors.length} attachment error(s)`,
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
      error: `${result.errors.length} attachment error(s)`,
      data: { scopes: result.scopes.length, claimed: totalClaimed, errors: result.errors.length },
    };
  }
  return {
    success: true,
    data: { scopes: result.scopes.length, claimed: totalClaimed, refreshed: totalRefreshed },
  };
}

/**
 * Overwrite a tracked attachment from stdin. The path must already be
 * manifested; new attachments go through `add`.
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

  await writeAttachment({ absPath, content: stdin });
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
  } catch {
    return { success: false, error: `${relPath} does not exist` };
  }

  const manifest: AttachManifest = await loadManifest(attachDir);
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
async function writeAttachment({ absPath, content }: { absPath: string; content: Buffer }): Promise<void> {
  // Best-effort chmod +w so we can overwrite a previously-locked file. Ignore
  // errors (file may not exist or filesystem may not support chmod).
  try { await fs.chmod(absPath, 0o644); } catch (_e) { /* ignore */ }
  const tmp = `${absPath}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, absPath);
  try { await fs.chmod(absPath, 0o444); } catch (_e) { /* ignore */ }
}

/**
 * Find the deepest `.attach/` directory enclosing a path. Returns the
 * scope's box-relative path, or null if none.
 *
 * Example:
 *   thread.attach/msg-001.attach/attachments/foo.png
 *   → thread.attach/msg-001.attach   (NOT thread.attach — deepest wins)
 */
function enclosingAttachScope(relPath: string): string | null {
  const parts = relPath.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]!.endsWith(".attach")) {
      return parts.slice(0, i + 1).join("/");
    }
  }
  return null;
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
  description: "Manifest-aware operations on binary attachments (verify, migrate, overwrite, add)",
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
