/**
 * Reconciliation + abandonment sweep for bulk-upload batches.
 *
 * Runs periodically in the webapp box scope (belt-and-braces with the startup
 * resume in `resume.ts`). Three jobs:
 *
 * - **Reconciliation.** A batch stuck `sealed`/`preparing` (a crashed worker) is
 *   re-fired. A `delivering` batch is re-fired ONLY once its `<upload>` message
 *   is confirmed in the target transcript — that path just finishes the
 *   bookkeeping (mark delivered + clean up staging). A `delivering` batch whose
 *   message hasn't landed yet is left alone: in a live process its enqueued
 *   message is still draining, and re-sending could double-deliver; a genuine
 *   crash-loss is recovered at the next startup (empty queue → probe is
 *   authoritative), never here.
 * - **Abandonment.** An `open` batch idle past {@link BULK_ABANDONMENT_WINDOW_MS}
 *   is surfaced (empty → discarded; otherwise logged — bulk is never
 *   auto-finalized, since finalize needs the uploader's explicit Done + failed
 *   report).
 * - **Unfiled batches.** A `delivered` `upload-batch` card still sitting under a
 *   `tmp-upload/` after {@link TMP_UPLOAD_STALE_MS} is surfaced to the target
 *   chat agent as a self-note (not just a server-log warn), so filing it stays
 *   the chat agent's visible duty.
 */

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";
import { getBoxTime } from "../../lib/time.js";
import { parseUploadBatch } from "../../schemas/upload-batch.js";
import { loadHistoryEntries } from "../chat/session/history.js";
import { userMessageAlreadyLanded } from "../chat/session/deliver-user-message.js";
import { listStagingSessions, cleanupStagingSession, isBulkSession } from "../capture/staging-store.js";
import { bulkBatchCardRelPath } from "./prepare.js";

/** No-activity window after which an open bulk batch is surfaced as abandoned. */
export const BULK_ABANDONMENT_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

/** Age after which a delivered batch still under `tmp-upload/` is flagged unfiled. */
export const TMP_UPLOAD_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Directories never worth descending into while hunting for `tmp-upload/`. */
const SKIP_DIRS = new Set([".git", "node_modules", "tmp", ".callback-box"]);

/** An unfiled batch to surface, with its resolved target chat (null → most-active). */
export interface UnfiledBatch {
  cardRelPath: string;
  sessionId: string | null;
  ageDays: number;
}

export interface BulkSweepDeps {
  boxRoot: string;
  /** Re-fire the worker for a reconcilable batch (server sweep only). */
  firePreparation?: ((id: string) => void) | undefined;
  /** Surface an unfiled ≥7-day batch as a self-note to its target chat. */
  notifyUnfiled?: ((batch: UnfiledBatch) => void) | undefined;
}

export interface BulkSweepResult {
  /** Ids whose worker this pass re-fired (reconciliation). */
  refired: string[];
  /** Empty open ids removed. */
  discarded: string[];
  /** Open ids idle past the window, surfaced (not auto-finalized). */
  abandoned: string[];
  /** Box-relative delivered batch cards under `tmp-upload/` past the stale age. */
  unfiled: string[];
}

/** Sweep one box's bulk batches once. Idempotent and safe to double-fire. */
export async function sweepBulkBatches(deps: BulkSweepDeps): Promise<BulkSweepResult> {
  const { boxRoot, firePreparation, notifyUnfiled } = deps;
  const now = getBoxTime(boxRoot).getTime();
  const result: BulkSweepResult = { refired: [], discarded: [], abandoned: [], unfiled: [] };

  const sessions = (await listStagingSessions({ boxRoot })).filter(isBulkSession);
  for (const session of sessions) {
    if (session.state === "sealed" || session.state === "preparing") {
      if (firePreparation) {
        result.refired.push(session.id);
        firePreparation(session.id);
      }
      continue;
    }
    if (session.state === "delivering") {
      if (firePreparation && (await deliveredMessageLanded({ boxRoot, session }))) {
        result.refired.push(session.id);
        firePreparation(session.id);
      }
      continue;
    }
    if (session.state !== "open") continue;

    if (now - new Date(session.lastActivityAt).getTime() < BULK_ABANDONMENT_WINDOW_MS) continue;
    const empty = session.files.length === 0 && (session.failedItems?.length ?? 0) === 0;
    if (empty) {
      await cleanupStagingSession({ boxRoot, id: session.id });
      result.discarded.push(session.id);
    } else {
      result.abandoned.push(session.id);
    }
  }

  if (result.abandoned.length > 0) {
    console.warn(
      `[bulk] Sweep found ${result.abandoned.length} abandoned open bulk batch(es) (not auto-finalized — the uploader must finish them): ${result.abandoned.join(", ")}`,
    );
  }

  const unfiled = await findStaleTmpUploadCards({ boxRoot, now });
  result.unfiled = unfiled.map((u) => u.cardRelPath);
  for (const batch of unfiled) {
    if (notifyUnfiled) notifyUnfiled(batch);
  }
  if (unfiled.length > 0 && !notifyUnfiled) {
    console.warn(
      `[bulk] Sweep found ${unfiled.length} delivered batch(es) unfiled in tmp-upload/ for over 7 days: ${result.unfiled.join(", ")}`,
    );
  }

  return result;
}

/** Whether a `delivering` batch's `<upload>` message is already in its transcript. */
async function deliveredMessageLanded(opts: {
  boxRoot: string;
  session: { createdAt: string; id: string; contextDir?: string | undefined; targetSessionId: string | null };
}): Promise<boolean> {
  const { boxRoot, session } = opts;
  const cardRelPath = bulkBatchCardRelPath({
    startedAt: session.createdAt,
    id: session.id,
    contextDir: session.contextDir ?? "",
  });
  return userMessageAlreadyLanded({ boxRoot, sessionId: session.targetSessionId, docPath: cardRelPath, logPrefix: "bulk" });
}

/**
 * Box-relative paths of `delivered` upload-batch cards under any `tmp-upload/`
 * whose `time.start` is older than the stale age, paired with the chat session
 * that owns the enclosing context dir (null → the notifier falls back to
 * most-active). Reference is the card's own `time.start` (deterministic under
 * `CB_TIME`), not file mtime (which git operations reset).
 */
async function findStaleTmpUploadCards(opts: { boxRoot: string; now: number }): Promise<UnfiledBatch[]> {
  const { boxRoot, now } = opts;
  const entries = await loadHistoryEntries(boxRoot);
  const dirToSession = new Map<string, string>();
  for (const e of entries) dirToSession.set(e.contextDir ?? "", e.id);

  const stale: UnfiledBatch[] = [];
  for (const dir of await findTmpUploadDirs(boxRoot, boxRoot)) {
    for (const card of await batchCardsIn(dir)) {
      const parsed = parseUploadBatch(await fs.readFile(card, "utf-8").catch(() => ""));
      if (parsed === null || parsed.frontmatter.status !== "delivered") continue;
      const startedAt = parsed.frontmatter.time?.start;
      if (startedAt === undefined) continue;
      const ageMs = now - new Date(startedAt).getTime();
      if (ageMs < TMP_UPLOAD_STALE_MS) continue;
      const relPath = path.relative(boxRoot, card);
      const contextDir = contextDirOfBatchCard(relPath);
      stale.push({
        cardRelPath: relPath,
        sessionId: contextDir === null ? null : dirToSession.get(contextDir) ?? null,
        ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      });
    }
  }
  return stale.toSorted((a, b) => a.cardRelPath.localeCompare(b.cardRelPath));
}

/** The context dir enclosing a `.../tmp-upload/<slug>/...card` path, or null. */
function contextDirOfBatchCard(relPath: string): string | null {
  const marker = "/tmp-upload/";
  const idx = relPath.indexOf(marker);
  if (idx !== -1) return relPath.slice(0, idx);
  return relPath.startsWith("tmp-upload/") ? "" : null;
}

/** `upload-batch` card absolute paths directly inside a batch dir under `dir`. */
async function batchCardsIn(tmpUploadDir: string): Promise<string[]> {
  const found: string[] = [];
  let batchDirs: Dirent[];
  try {
    batchDirs = await fs.readdir(tmpUploadDir, { withFileTypes: true });
  } catch (_e) {
    return found;
  }
  for (const batch of batchDirs) {
    if (!batch.isDirectory()) continue;
    const batchAbs = path.join(tmpUploadDir, batch.name);
    let entries: string[];
    try {
      entries = await fs.readdir(batchAbs);
    } catch (_e) {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".upload-batch.card")) found.push(path.join(batchAbs, entry));
    }
  }
  return found;
}

/** Recursively collect every `tmp-upload` directory under `root`. */
async function findTmpUploadDirs(boxRoot: string, root: string): Promise<string[]> {
  const found: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (_e) {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(root, entry.name);
    if (entry.name === "tmp-upload") {
      found.push(abs);
      continue;
    }
    found.push(...(await findTmpUploadDirs(boxRoot, abs)));
  }
  return found;
}
