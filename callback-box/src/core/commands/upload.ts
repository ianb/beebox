/**
 * cb upload — Batch-upload files into the box, deduping by content hash.
 *
 * Each file is hashed; if its SHA-256 already appears in
 * `.callback-box/uploads.json`, the file is skipped (use `--force` to re-import).
 * Otherwise we dispatch to a destination handler based on `--as <kind>` and
 * record the result. Today the only kind is `scan`, which calls scan-import.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  registerCommand,
  runCommand,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getBoxTimeISO } from "../../cli/lib/time.js";
import {
  loadLedger,
  saveLedger,
  sha256File,
  findEntry,
  addEntry,
  groupScanFiles,
  type UploadLedgerEntry,
  type ScanGroup,
} from "./upload-helpers.js";

export interface UploadArgs {
  files: string[];
  kind: string;
  force?: boolean;
  context?: string;
  /** Process at most this many files (after sort, before grouping). For smoke tests. */
  limit?: number;
}

const SUPPORTED_KINDS = ["scan"] as const;
type UploadKind = (typeof SUPPORTED_KINDS)[number];

function isSupportedKind(kind: string): kind is UploadKind {
  return (SUPPORTED_KINDS as readonly string[]).includes(kind);
}

async function executeUpload(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const { files, kind, force, context: extraContext, limit } = args as unknown as UploadArgs;

  if (!files || files.length === 0) {
    return { success: false, error: "At least one file is required" };
  }
  if (!kind) {
    return { success: false, error: "--as <kind> is required" };
  }
  if (!isSupportedKind(kind)) {
    return {
      success: false,
      error: `Unknown kind '${kind}'. Supported: ${SUPPORTED_KINDS.join(", ")}`,
    };
  }

  // Resolve to absolute paths and validate up-front so a typo doesn't half-finish a batch.
  const absoluteFiles: string[] = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return { success: false, error: `Not a regular file: ${abs}` };
      }
    } catch {
      return { success: false, error: `File not found: ${abs}` };
    }
    absoluteFiles.push(abs);
  }

  // For smoke tests: cap the number of files before grouping so a paired batch
  // still gets its photo-and-back together (sorted, so first N are contiguous).
  const limitedFiles = typeof limit === "number" && limit > 0 && limit < absoluteFiles.length
    ? absoluteFiles.toSorted().slice(0, limit)
    : absoluteFiles;
  if (limitedFiles.length < absoluteFiles.length) {
    ctx.writeLine(`Limit applied: processing ${limitedFiles.length} of ${absoluteFiles.length} file(s)`);
  }

  let groups: ScanGroup[];
  try {
    groups = groupScanFiles(limitedFiles);
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  ctx.writeLine(`Found ${groups.length} group${groups.length === 1 ? "" : "s"}:`);
  for (const g of groups) {
    ctx.writeLine(`  [${g.kind}] ${g.label} (${g.files.length} file${g.files.length === 1 ? "" : "s"})`);
  }

  const ledger = await loadLedger(ctx.boxRoot);
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const group of groups) {
    ctx.writeLine(`\n→ [${group.kind}] ${group.label}`);

    const hashes: { file: string; hash: string }[] = [];
    for (const file of group.files) {
      hashes.push({ file, hash: await sha256File(file) });
    }
    const existingForHashes = hashes.map((h) => findEntry(ledger, h.hash));
    const allSeen = existingForHashes.every((e) => e !== undefined);
    if (allSeen && !force) {
      const withSession = existingForHashes.find((e) => e !== undefined && typeof e.sessionRelDir === "string");
      const where = withSession && withSession.sessionRelDir ? ` → ${withSession.sessionRelDir}` : "";
      ctx.writeLine(
        `  skipped (all ${group.files.length} file${group.files.length === 1 ? "" : "s"} already uploaded${where}); use --force to re-import`
      );
      skipped++;
      continue;
    }

    const scanArgs: Record<string, unknown> = { inputs: group.files };
    if (extraContext && extraContext.trim().length > 0) scanArgs["context"] = extraContext;
    const result = await runCommand({ name: "scan-import", args: scanArgs, ctx });

    if (!result.success) {
      ctx.writeLine(`  failed: ${result.error}`);
      failed++;
      continue;
    }

    const data = result.data as { sessionRelDir?: string } | undefined;
    const sessionRelDir = data && typeof data.sessionRelDir === "string" ? data.sessionRelDir : undefined;
    for (const { file, hash } of hashes) {
      if (findEntry(ledger, hash) !== undefined) continue;
      const entry: UploadLedgerEntry = {
        hash,
        originalName: path.basename(file),
        originalPath: file,
        uploadedAt: getBoxTimeISO(ctx.boxRoot),
        kind,
      };
      if (sessionRelDir) entry.sessionRelDir = sessionRelDir;
      addEntry(ledger, entry);
    }
    // Save after each group so a crash mid-batch still preserves the dedup record.
    await saveLedger(ctx.boxRoot, ledger);
    imported++;
  }

  ctx.writeLine(`\nUpload summary: ${imported} group${imported === 1 ? "" : "s"} imported, ${skipped} skipped, ${failed} failed`);
  return {
    success: failed === 0,
    data: { imported, skipped, failed },
  };
}

registerCommand({
  name: "upload",
  description: "Upload a batch of files to the box (dedup by content hash)",
  args: [
    { name: "files", description: "Files to upload", required: true, type: "string[]" },
    { name: "kind", description: "Destination kind (currently: scan)", required: true, type: "string" },
    { name: "force", description: "Re-import files already in the ledger", required: false, default: false, type: "boolean" },
    { name: "context", description: "Per-batch context passed to the destination handler", required: false, type: "string" },
    { name: "limit", description: "Process at most N files (sorted; useful for smoke tests)", required: false, type: "number" },
  ],
  execute: executeUpload,
});

export { executeUpload };
