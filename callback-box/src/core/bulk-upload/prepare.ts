/**
 * Bulk-upload preparation (Track 1 of `docs/implemented-plans/bulk-file-upload.md`).
 *
 * Turns a bulk staging session into a committed `upload-batch` document under
 * the target chat's `tmp-upload/`: it **copies** (never moves — parity with
 * capture, which retains staging until delivery is confirmed) the staged files
 * into the batch's attach scope, writes that scope's asset `manifest.json` + a
 * batch-local `.gitignore`, writes the summary card, and commits card + manifest
 * + gitignore (blobs stay out of git, per `docs/asset-manifests.md`).
 *
 * Idempotence: the batch slug is derived from the session's stable `createdAt` +
 * id, so a crash re-run targets the SAME dir. The card is written last, so its
 * existence marks completion — a re-run whose card exists skips the copy/write
 * and re-commits (a no-op when clean), never a second batch. Sanitization +
 * collision dedupe are deterministic over staged-file order. A commit failure
 * throws loudly; nothing is deleted, so the whole run is safe to retry.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageAndCommitPaths } from "../../lib/git.js";
import { sanitizeFilename, dedupeName, summarizeBatch } from "./batch-format.js";
import { computeEntry, emptyManifest, saveManifest } from "../asset-manifest.js";
import { createUploadBatchTemplate, parseUploadBatch, type UploadBatchReceived } from "../../schemas/upload-batch.js";
import {
  readStagingSession,
  stagingSessionDir,
  isBulkSession,
  type StagingSession,
} from "../capture/staging-store.js";

/** The staging session named for bulk preparation is not a `kind: "bulk"` session. */
export class NotABulkSessionError extends Error {
  constructor(id: string) {
    super(`Staging session ${id} is not a bulk-upload session`);
    this.name = "NotABulkSessionError";
  }
}

/** A batch's resolved directory escapes the box root (poisoned `contextDir`). */
export class BulkBatchPathError extends Error {
  constructor(batchRelDir: string) {
    super(`Bulk batch dir escapes the box root: ${batchRelDir}`);
    this.name = "BulkBatchPathError";
  }
}

/**
 * Defense-in-depth containment guard: the batch dir MUST resolve to inside the
 * box root. `contextDir` is server-derived (never client-supplied) since the
 * traversal fix, but a poisoned on-disk session manifest is still untrusted
 * input — a batch dir that escapes is a broken invariant, not a fallback case.
 * Mirrors the containment idiom in `webapp/routes/chat-uploads.ts`.
 */
function assertBatchDirContained(opts: { boxRoot: string; batchRelDir: string }): void {
  const boxResolved = path.resolve(opts.boxRoot);
  const resolved = path.resolve(path.join(opts.boxRoot, opts.batchRelDir));
  if (resolved !== boxResolved && !resolved.startsWith(boxResolved + path.sep)) {
    throw new BulkBatchPathError(opts.batchRelDir);
  }
}

/** An item the uploader reported as failed at finalize (supplied by the caller). */
export interface BulkFailedItem {
  /** Predeclared registry item id, when the uploader knows it. */
  id?: string | undefined;
  name: string;
  reason: string;
}

export interface PreparedBulkBatch {
  batchSlug: string;
  /** Box-relative path of the written `upload-batch` card. */
  cardRelPath: string;
  /** Box-relative attach-scope dir holding the blobs + `manifest.json`. */
  attachRelDir: string;
  counts: { registered: number; received: number; missing: number; failed: number };
  totalBytes: number;
  /** The batch's one-line summary — the card body and the `<upload>` wrapper body. */
  summary: string;
  /** The boxholder's verbatim introduction, when the batch carried one. */
  note: string | undefined;
}

/**
 * Prepare (copy + card + attach manifest + commit) one bulk staging session.
 * Returns the batch summary, or `null` if the session vanished before prepare
 * ran (cleaned up / cancelled). Throws {@link NotABulkSessionError} if the id
 * names a non-bulk session.
 */
export async function prepareBulkBatch(opts: {
  boxRoot: string;
  id: string;
  /** Box-relative target context dir; `""`/absent lands at the box root. */
  contextDir: string;
  /** Items the uploader reported failing (name + reason), for the `failed` list. */
  failedItems?: BulkFailedItem[];
}): Promise<PreparedBulkBatch | null> {
  const { boxRoot, id, contextDir } = opts;
  const failedItems = opts.failedItems ?? [];

  const session = await readStagingSession({ boxRoot, id });
  if (session === null) return null;
  if (!isBulkSession(session)) throw new NotABulkSessionError(id);

  const batchSlug = bulkBatchSlug({ startedAt: session.createdAt, id });
  const batchRelDir = bulkBatchRelDir({ startedAt: session.createdAt, id, contextDir });
  assertBatchDirContained({ boxRoot, batchRelDir });
  const cardRelPath = `${batchRelDir}/Batch.upload-batch.card`;
  const attachRelDir = `${batchRelDir}/Batch.upload-batch.attach`;
  const cardAbsPath = path.join(boxRoot, cardRelPath);
  const attachAbsDir = path.join(boxRoot, attachRelDir);
  const manifestRelPath = `${attachRelDir}/manifest.json`;
  const gitignoreRelPath = `${attachRelDir}/.gitignore`;

  const summary = await buildBatchSummary({ boxRoot, session, cardAbsPath, attachAbsDir, failedItems });

  // Bulk lands ARBITRARY extensions (.zip, .csv, extensionless, …), which the
  // box's extension-based asset gitignore doesn't cover — so an uncovered blob
  // would show as untracked forever and a stray `git add -A` could commit it,
  // defeating the manifest model. A batch-local `.gitignore` ignores everything
  // in the scope except its own manifest + itself, regardless of extension
  // (see docs/asset-manifests.md, issue bulk-upload-arbitrary-ext-gitignore).
  await writeAttachGitignore(attachAbsDir);

  // Commit the card + manifest + local .gitignore (never the blobs). Idempotent:
  // a clean re-run commits nothing; a real git failure throws loudly and leaves
  // staging intact.
  await stageAndCommitPaths(boxRoot, {
    paths: [cardRelPath, manifestRelPath, gitignoreRelPath],
    message: `Upload batch: ${batchSlug}`,
    trailers: { "Created-By": "bulk-upload" },
  });

  return {
    batchSlug,
    cardRelPath,
    attachRelDir,
    counts: {
      registered: session.expectedItems?.length ?? 0,
      received: summary.received.length,
      missing: summary.missing.length,
      failed: summary.failed.length,
    },
    totalBytes: summary.totalBytes,
    summary: summary.summary,
    note: summary.note,
  };
}

/** Contents of a batch attach scope's local `.gitignore`. */
const ATTACH_GITIGNORE = `# Bulk-upload blobs are tracked via manifest.json (size + sha256), not committed
# directly, regardless of extension. See docs/asset-manifests.md.
*
!.gitignore
!manifest.json
`;

/** Write the batch-local `.gitignore` (idempotent — always the same content). */
async function writeAttachGitignore(attachAbsDir: string): Promise<void> {
  await fs.writeFile(path.join(attachAbsDir, ".gitignore"), ATTACH_GITIGNORE);
}

interface BatchSummary {
  received: UploadBatchReceived[];
  missing: string[];
  failed: Array<{ name: string; reason: string }>;
  totalBytes: number;
  /** The one-line card body summary (regenerated fresh, or recovered from the card). */
  summary: string;
  /** The boxholder's introduction (from the sealed session, or recovered from the card). */
  note: string | undefined;
}

/**
 * Build (or, on an idempotent re-run, recover) the batch's received/missing/
 * failed summary. When the card doesn't yet exist this copies the staged files
 * into the attach scope, writes the manifest, and writes the card (last, as the
 * completion marker); when it exists the card is parsed back rather than
 * rewriting bytes (which would change mtimes and defeat idempotence).
 */
async function buildBatchSummary(opts: {
  boxRoot: string;
  session: StagingSession;
  cardAbsPath: string;
  attachAbsDir: string;
  failedItems: BulkFailedItem[];
}): Promise<BatchSummary> {
  const { boxRoot, session, cardAbsPath, attachAbsDir, failedItems } = opts;

  if (await fileExists(cardAbsPath)) return recoverSummaryFromCard(cardAbsPath);

  const sessionDir = stagingSessionDir(boxRoot, session.id);
  await fs.mkdir(attachAbsDir, { recursive: true });

  const manifest = emptyManifest();
  const received: UploadBatchReceived[] = [];
  const usedNames = new Set<string>();
  const arrivedKeys = new Set<string>();

  for (const file of session.files) {
    const destName = dedupeName(sanitizeFilename(file.originalName || file.filename), usedNames);
    const destAbs = path.join(attachAbsDir, destName);
    await fs.copyFile(path.join(sessionDir, file.filename), destAbs);
    const entry = await computeEntry(destAbs);
    manifest.files[destName] = entry;

    const item: UploadBatchReceived = { name: destName, size: entry.size };
    if (file.mimeType !== "") item.mimetype = file.mimeType;
    received.push(item);

    // Match arrival by itemId — every bulk upload carries the registry id, so
    // id is authoritative. Name is only a fallback for a file that somehow lacks
    // an itemId (two registry items can share a name; matching by name alone
    // would wrongly mark BOTH arrived when only one did).
    if (file.itemId !== undefined) arrivedKeys.add(`id:${file.itemId}`);
    else arrivedKeys.add(`name:${file.originalName}`);
  }

  await saveManifest(attachAbsDir, manifest);

  const failed = failedItems.map((f) => ({ name: f.name, reason: f.reason }));
  const failedKeys = new Set<string>();
  for (const f of failedItems) {
    // Key by id when the uploader knows it, by name ONLY as the fallback for one
    // that doesn't. Adding both would let a single failed item mask every OTHER
    // registry item sharing its name: two picks both called `image.png`, one
    // reported failed and one that never arrived, and the second silently drops
    // out of `missing` — so registered no longer reconciles with
    // received+failed+missing, which is the whole point of the registry.
    if (f.id !== undefined) failedKeys.add(`id:${f.id}`);
    else failedKeys.add(`name:${f.name}`);
  }

  const missing = (session.expectedItems ?? [])
    .filter((it) => {
      const arrived = arrivedKeys.has(`id:${it.id}`) || arrivedKeys.has(`name:${it.name}`);
      const isFailed = failedKeys.has(`id:${it.id}`) || failedKeys.has(`name:${it.name}`);
      return !arrived && !isFailed;
    })
    .map((it) => it.name);
  // NB: `arrived` above resolves by id first (see arrivedKeys construction) — the
  // name branch only catches the itemId-less fallback, so same-named registry
  // items are told apart correctly.

  const totalBytes = received.reduce((n, r) => n + r.size, 0);
  const endedAt = latestUploadedAt(session) ?? session.createdAt;
  const summary = summarizeBatch({ received: received.length, missing: missing.length, failed: failed.length, totalBytes });

  const cardContent = createUploadBatchTemplate({
    batchId: bulkBatchSlug({ startedAt: session.createdAt, id: session.id }),
    targetSessionId: session.targetSessionId,
    startedAt: session.createdAt,
    endedAt,
    registered: session.expectedItems?.length ?? 0,
    totalBytes,
    received,
    missing,
    failed,
    summary,
    note: session.note,
  });
  await fs.writeFile(cardAbsPath, cardContent);

  return { received, missing, failed, totalBytes, summary, note: session.note };
}

/** Recover the summary from an already-written card (idempotent re-run). */
async function recoverSummaryFromCard(cardAbsPath: string): Promise<BatchSummary> {
  const content = await fs.readFile(cardAbsPath, "utf-8");
  const parsed = parseUploadBatch(content);
  if (parsed === null) return { received: [], missing: [], failed: [], totalBytes: 0, summary: "", note: undefined };
  const fm = parsed.frontmatter;
  return {
    received: (fm.received ?? []).map((r) => (r.mimetype !== undefined ? { name: r.name, size: r.size, mimetype: r.mimetype } : { name: r.name, size: r.size })),
    missing: (fm.missing ?? []).map((m) => m.name),
    failed: (fm.failed ?? []).map((f) => ({ name: f.name, reason: f.reason })),
    totalBytes: fm["total-bytes"],
    summary: parsed.body.trim(),
    note: fm.note,
  };
}

/** Deterministic `upload-YYYYMMDDTHHMM-<shortId>` slug (mirrors capture's). */
export function bulkBatchSlug(opts: { startedAt: string; id: string }): string {
  const datePart = new Date(opts.startedAt).toISOString().slice(0, 16).replace(/[:-]/g, "");
  const formattedDate = `${datePart.slice(0, 8)}T${datePart.slice(9, 13)}`;
  return `upload-${formattedDate}-${opts.id.slice(0, 8)}`;
}

/** Box-relative batch dir: `<contextDir>/tmp-upload/<slug>` (root when contextDir is ""). */
export function bulkBatchRelDir(opts: { startedAt: string; id: string; contextDir: string }): string {
  const slug = bulkBatchSlug({ startedAt: opts.startedAt, id: opts.id });
  const uploadRelDir = opts.contextDir !== "" ? `${opts.contextDir}/tmp-upload` : "tmp-upload";
  return `${uploadRelDir}/${slug}`;
}

/** Box-relative path of a batch's `upload-batch` card, derived from the session. */
export function bulkBatchCardRelPath(opts: { startedAt: string; id: string; contextDir: string }): string {
  return `${bulkBatchRelDir(opts)}/Batch.upload-batch.card`;
}

/** Latest `uploadedAt` across the staged files, or `null` when there are none. */
function latestUploadedAt(session: StagingSession): string | null {
  return session.files.reduce<string | null>(
    (latest, f) => (latest === null || f.uploadedAt > latest ? f.uploadedAt : latest),
    null,
  );
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    return false;
  }
}
