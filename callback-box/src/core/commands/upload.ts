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
import { z } from "zod";
import {
  registerCommand,
  runCommand,
  parseCommandArgs,
  type CommandContext,
  type CommandResult,
} from "../command-runner.js";
import { getBoxTimeISO } from "../../lib/time.js";
import {
  loadLedger,
  saveLedger,
  sha256File,
  findEntry,
  addEntry,
  groupScanFiles,
  type UploadLedger,
  type UploadLedgerEntry,
  type ScanGroup,
} from "./upload-helpers.js";
import { errorMessage } from "../../lib/error-guards.js";
import { isRecord } from "../card-io.js";

const UploadArgsSchema = z.object({
  files: z.array(z.string()).optional(),
  kind: z.string().optional(),
  force: z.boolean().optional(),
  context: z.string().optional(),
  /** Process at most this many files (after sort, before grouping). For smoke tests. */
  limit: z.number().optional(),
});
export type UploadArgs = z.infer<typeof UploadArgsSchema>;

const SUPPORTED_KINDS = ["scan"] as const;
type UploadKind = (typeof SUPPORTED_KINDS)[number];
const SUPPORTED_KINDS_SET: ReadonlySet<string> = new Set(SUPPORTED_KINDS);

function isSupportedKind(kind: string): kind is UploadKind {
  return SUPPORTED_KINDS_SET.has(kind);
}

/** Validate the raw upload args. Returns an error string, or the typed args. */
function validateUploadArgs(
  args: Record<string, unknown>
): { error: string } | { args: UploadArgs & { files: string[]; kind: UploadKind } } {
  const typed = parseCommandArgs(args, UploadArgsSchema);
  const { files, kind } = typed;

  if (!files || files.length === 0) {
    return { error: "At least one file is required" };
  }
  if (!kind) {
    return { error: "--as <kind> is required" };
  }
  if (!isSupportedKind(kind)) {
    return { error: `Unknown kind '${kind}'. Supported: ${SUPPORTED_KINDS.join(", ")}` };
  }
  // Return the presence-checked `files`/`kind` as non-optional so callers get
  // the validated shape without re-checking (the schema keeps them optional so
  // the messages above own the presence contract).
  return { args: { ...typed, files, kind } };
}

/**
 * Resolve inputs to absolute paths and validate up-front so a typo doesn't
 * half-finish a batch. Returns an error string, or the absolute paths.
 */
async function resolveAndValidateFiles(
  files: string[]
): Promise<{ error: string } | { absoluteFiles: string[] }> {
  const absoluteFiles: string[] = [];
  for (const f of files) {
    const abs = path.isAbsolute(f) ? f : path.resolve(process.cwd(), f);
    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return { error: `Not a regular file: ${abs}` };
      }
    } catch (e) {
      console.warn(`Could not stat ${abs}:`, e);
      return { error: `File not found: ${abs}` };
    }
    absoluteFiles.push(abs);
  }
  return { absoluteFiles };
}

/**
 * Cap the number of files before grouping (for smoke tests) so a paired batch
 * still gets its photo-and-back together (sorted, so first N are contiguous).
 */
function applyFileLimit(
  ctx: CommandContext,
  { absoluteFiles, limit }: { absoluteFiles: string[]; limit: number | undefined }
): string[] {
  const limitedFiles =
    typeof limit === "number" && limit > 0 && limit < absoluteFiles.length
      ? absoluteFiles.toSorted().slice(0, limit)
      : absoluteFiles;
  if (limitedFiles.length < absoluteFiles.length) {
    ctx.writeLine(`Limit applied: processing ${limitedFiles.length} of ${absoluteFiles.length} file(s)`);
  }
  return limitedFiles;
}

interface GroupOutcome {
  status: "imported" | "skipped" | "failed";
}

/**
 * Process one scan group: hash its files, skip if all already in the ledger
 * (unless forced), otherwise dispatch to scan-import and record the result.
 * Persists the ledger after a successful import.
 */
async function processGroup(
  ctx: CommandContext,
  options: {
    group: ScanGroup;
    ledger: UploadLedger;
    kind: string;
    force: boolean | undefined;
    extraContext: string | undefined;
  }
): Promise<GroupOutcome> {
  const { group, ledger, kind, force, extraContext } = options;
  ctx.writeLine(`\n→ [${group.kind}] ${group.label}`);

  const hashes: { file: string; hash: string }[] = [];
  for (const file of group.files) {
    hashes.push({ file, hash: await sha256File(file) });
  }
  const existingForHashes = hashes.map((h) => findEntry(ledger, h.hash));
  const allSeen = existingForHashes.every((e) => e !== undefined);
  if (allSeen && !force) {
    const withSession = existingForHashes.find((e) => typeof e.sessionRelDir === "string");
    const where = withSession && withSession.sessionRelDir ? ` → ${withSession.sessionRelDir}` : "";
    ctx.writeLine(
      `  skipped (all ${group.files.length} file${group.files.length === 1 ? "" : "s"} already uploaded${where}); use --force to re-import`
    );
    return { status: "skipped" };
  }

  const scanArgs: Record<string, unknown> = { inputs: group.files };
  if (extraContext && extraContext.trim().length > 0) scanArgs["context"] = extraContext;
  const result = await runCommand({ name: "scan-import", args: scanArgs, ctx });

  if (!result.success) {
    ctx.writeLine(`  failed: ${result.error}`);
    return { status: "failed" };
  }

  const { data } = result;
  const sessionRelDir = isRecord(data) && typeof data.sessionRelDir === "string" ? data.sessionRelDir : undefined;
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
  return { status: "imported" };
}

async function executeUpload(
  ctx: CommandContext,
  args: Record<string, unknown>
): Promise<CommandResult> {
  const validated = validateUploadArgs(args);
  if ("error" in validated) {
    return { success: false, error: validated.error };
  }
  const { kind, force, context: extraContext, limit } = validated.args;

  const resolved = await resolveAndValidateFiles(validated.args.files);
  if ("error" in resolved) {
    return { success: false, error: resolved.error };
  }

  const limitedFiles = applyFileLimit(ctx, { absoluteFiles: resolved.absoluteFiles, limit });

  let groups: ScanGroup[];
  try {
    groups = groupScanFiles(limitedFiles);
  } catch (e) {
    return { success: false, error: errorMessage(e) };
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
    const outcome = await processGroup(ctx, { group, ledger, kind, force, extraContext });
    if (outcome.status === "imported") imported++;
    else if (outcome.status === "skipped") skipped++;
    else failed++;
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
