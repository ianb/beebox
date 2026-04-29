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
  type UploadLedgerEntry,
} from "./upload-helpers.js";

export interface UploadArgs {
  files: string[];
  kind: string;
  force?: boolean;
  context?: string;
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
  const { files, kind, force, context: extraContext } = args as unknown as UploadArgs;

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

  const ledger = await loadLedger(ctx.boxRoot);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const filePath of absoluteFiles) {
    const baseName = path.basename(filePath);
    ctx.writeLine(`\n→ ${baseName}`);

    const hash = await sha256File(filePath);
    const existing = findEntry(ledger, hash);
    if (existing && !force) {
      const where = existing.sessionRelDir ? ` → ${existing.sessionRelDir}` : "";
      ctx.writeLine(
        `  skipped (uploaded ${existing.uploadedAt} as ${existing.kind}${where}); use --force to re-import`
      );
      skipped++;
      continue;
    }

    let result: CommandResult;
    if (kind === "scan") {
      const scanArgs: Record<string, unknown> = { pdfPath: filePath };
      if (extraContext && extraContext.trim().length > 0) {
        scanArgs["context"] = extraContext;
      }
      result = await runCommand({ name: "scan-import", args: scanArgs, ctx });
    } else {
      result = { success: false, error: `Unsupported kind '${kind}'` };
    }

    if (!result.success) {
      ctx.writeLine(`  failed: ${result.error}`);
      failed++;
      continue;
    }

    const data = result.data as { sessionRelDir?: string } | undefined;
    const entry: UploadLedgerEntry = {
      hash,
      originalName: baseName,
      originalPath: filePath,
      uploadedAt: getBoxTimeISO(ctx.boxRoot),
      kind,
    };
    if (data && typeof data.sessionRelDir === "string") {
      entry.sessionRelDir = data.sessionRelDir;
    }
    addEntry(ledger, entry);
    // Save after each file so a crash mid-batch still preserves the dedup record.
    await saveLedger(ctx.boxRoot, ledger);
    imported++;
  }

  ctx.writeLine(`\nUpload summary: ${imported} imported, ${skipped} skipped, ${failed} failed`);
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
  ],
  execute: executeUpload,
});

export { executeUpload };
