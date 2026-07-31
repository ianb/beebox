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
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { parseUploadBatch } from "../../schemas/upload-batch.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { withCardLock } from "../../lib/card-lock.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { userMessageAlreadyLanded } from "../chat/session/deliver-user-message.js";
import { listStagingSessions, isBulkSession, readStagingSession, writeStagingSession, type StagingSession, type StagingSessionState } from "../capture/staging-store.js";
import { cleanupStagingSession, discardStagingSessionIfCancellable } from "../capture/staging-teardown.js";
import { bulkBatchHasNothingToReport } from "./batch-format.js";
import { StagingSessionGoneError } from "../capture/staging-errors.js";
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

/**
 * A batch the box accepted (sealed) but could not deliver, so no `<upload>`
 * message ever reached the chat.
 *
 * This is the recovery hand-off. The uploader is deliberately NOT the recovery
 * mechanism: once a batch is sealed the box holds the bytes AND the boxholder's
 * introduction, so it — not a retry button on a phone that may never come back —
 * is what has to notice and act. Surfacing it to the chat agent with enough
 * context to explain or re-file matches this feature's premise: the upload
 * surface just lands bytes durably, the agent does the thinking
 * (`docs/implemented-plans/bulk-file-upload.md`).
 */
export interface StrandedBatch {
  sessionId: string;
  /** The chat the batch was bound to. */
  targetSessionId: string | null;
  state: StagingSessionState;
  receivedCount: number;
  failedCount: number;
  registeredCount: number;
  /** The boxholder's introduction, if they submitted one. */
  note: string | undefined;
}

export interface BulkSweepDeps {
  boxRoot: string;
  /** Re-fire the worker for a reconcilable batch (server sweep only). */
  firePreparation?: ((id: string) => void) | undefined;
  /** Surface an unfiled ≥7-day batch as a self-note to its target chat. */
  notifyUnfiled?: ((batch: UnfiledBatch) => void) | undefined;
  /** Surface a sealed-but-undeliverable batch to its chat agent for recovery. */
  notifyStranded?: ((batch: StrandedBatch) => void) | undefined;
}

export interface BulkSweepResult {
  /** Ids whose worker this pass re-fired (reconciliation). */
  refired: string[];
  /** Empty open ids removed. */
  discarded: string[];
  /** Open ids idle past the window, surfaced (not auto-finalized). */
  abandoned: string[];
  /** `delivered` ids whose leaked staging this pass tore down. */
  cleaned: string[];
  /** Ids surfaced to the agent as sealed-but-undelivered. */
  stranded: string[];
  /** Box-relative delivered batch cards under `tmp-upload/` past the stale age. */
  unfiled: string[];
}


/**
 * Hand a sealed-but-undeliverable batch to the chat agent, exactly once.
 *
 * The worker already gave up (a re-fire would fail identically), and a
 * `console.error` reaches nobody. The box holds the bytes and the boxholder's
 * introduction, so the box is what must notice — the uploader may be a phone
 * that never comes back. Returns whether this pass surfaced it.
 */
async function surfaceStrandedBatch(opts: {
  boxRoot: string;
  session: StagingSession;
  notifyStranded: ((batch: StrandedBatch) => void) | undefined;
}): Promise<boolean> {
  const { boxRoot, session, notifyStranded } = opts;
  if (!notifyStranded || session.strandedNotifiedAt !== undefined) return false;
  notifyStranded({
    sessionId: session.id,
    targetSessionId: session.targetSessionId,
    state: session.state,
    receivedCount: session.files.length,
    failedCount: session.failedItems?.length ?? 0,
    registeredCount: session.expectedItems?.length ?? 0,
    note: session.note,
  });
  const marked = await readStagingSession({ boxRoot, id: session.id });
  if (marked) {
    marked.strandedNotifiedAt = getBoxTimeISO(boxRoot);
    await writeStagingSession({ boxRoot, session: marked });
  }
  return true;
}

/** Sweep one box's bulk batches once. Idempotent and safe to double-fire. */
export async function sweepBulkBatches(deps: BulkSweepDeps): Promise<BulkSweepResult> {
  const { boxRoot, firePreparation, notifyUnfiled, notifyStranded } = deps;
  const now = getBoxTime(boxRoot).getTime();
  const result: BulkSweepResult = { refired: [], discarded: [], abandoned: [], cleaned: [], stranded: [], unfiled: [] };

  const sessions = (await listStagingSessions({ boxRoot })).filter(isBulkSession);
  for (const session of sessions) {
    // A `delivered` batch whose staging teardown failed after delivery — retry
    // the delete (cleanup logs on failure and leaves session.json on `delivered`,
    // so the next sweep keeps retrying until it lands).
    if (session.state === "delivered") {
      await cleanupStagingSession({ boxRoot, id: session.id });
      result.cleaned.push(session.id);
      continue;
    }
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
    // Sealed but undeliverable — hand recovery to the agent (see below).
    if (session.state.startsWith("failed:")) {
      if (await surfaceStrandedBatch({ boxRoot, session, notifyStranded })) {
        result.stranded.push(session.id);
      }
      continue;
    }
    if (session.state !== "open") continue;

    if (now - new Date(session.lastActivityAt).getTime() < BULK_ABANDONMENT_WINDOW_MS) continue;
    if (bulkBatchHasNothingToReport(session)) {
      // Through the LOCKED discard, never a bare delete. `session` here is a
      // snapshot taken before the abandonment-window check, so the user can press
      // Done and seal the batch in between — a bare delete would then remove the
      // directory out from under the worker, which reads `null` and silently
      // returns while the client that already saw finalize succeed treats the
      // resulting 404 as "delivered" and drops its recovery state. The locked
      // helper re-reads the state and refuses anything past the seal.
      try {
        const discard = await discardStagingSessionIfCancellable({
          boxRoot,
          id: session.id,
          // The whole decision is re-made against the fresh session under the
          // lock. `session` above is a snapshot; between reading it and taking
          // the lock the user can come back and register/upload files, all of
          // which leave the batch `open` — a state-only guard would delete a
          // batch someone is actively filling.
          stillDiscardable: (fresh) =>
            bulkBatchHasNothingToReport(fresh) &&
            now - new Date(fresh.lastActivityAt).getTime() >= BULK_ABANDONMENT_WINDOW_MS,
        });
        if (discard.discarded) result.discarded.push(session.id);
        else console.warn(`[bulk] Sweep skipped ${session.id}: it was sealed (${String(discard.blockedBy)}) while the sweep ran.`);
      } catch (e) {
        // Gone already (another sweep, a cancel) or the delete failed — neither
        // is worth aborting the rest of the sweep for. A failed delete leaves
        // the session on disk for the next pass.
        if (!(e instanceof StagingSessionGoneError)) {
          console.error(`[bulk] Sweep could not discard ${session.id}:`, e);
        }
      }
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
    // Mark-once BEFORE notifying: persist a committed `sweep-notified` timestamp
    // so `findStaleTmpUploadCards` skips this card on every later sweep — the
    // self-note fires at most ONCE ever, not every cycle. (A failed injection
    // won't retry, an accepted trade-off: the card still exists and is
    // independently discoverable, and re-firing every 10 min is the worse fault.)
    await markBatchSweepNotified({ boxRoot, cardRelPath: batch.cardRelPath });
    if (notifyUnfiled) notifyUnfiled(batch);
  }
  if (unfiled.length > 0 && !notifyUnfiled) {
    console.warn(
      `[bulk] Sweep found ${unfiled.length} delivered batch(es) unfiled in tmp-upload/ for over 7 days: ${result.unfiled.join(", ")}`,
    );
  }

  return result;
}

/** Stamp `sweep-notified` on a batch card and commit it (once-ever guard). */
async function markBatchSweepNotified(opts: { boxRoot: string; cardRelPath: string }): Promise<void> {
  const { boxRoot, cardRelPath } = opts;
  const cardAbsPath = path.join(boxRoot, cardRelPath);
  try {
    const changed = await withCardLock(cardAbsPath, async () => {
      const content = await fs.readFile(cardAbsPath, "utf-8");
      const parsed = parseCardText(content, { source: cardAbsPath, schemas: await createCardSchemaMap() });
      if (parsed.fields["sweep-notified"] !== undefined) return false;
      parsed.fields["sweep-notified"] = getBoxTimeISO(boxRoot);
      await fs.writeFile(cardAbsPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
      return true;
    });
    if (!changed) return;
    await stageAndCommitPaths(boxRoot, {
      paths: [cardRelPath],
      message: `Upload batch sweep-notified: ${path.basename(path.dirname(cardRelPath))}`,
      trailers: { "Created-By": "bulk-upload" },
    });
  } catch (e) {
    // Best-effort: a failed mark means the batch may notify again next sweep —
    // preferable to throwing and aborting the whole sweep.
    console.error(`[bulk] Failed to mark ${cardRelPath} sweep-notified:`, e);
  }
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
 * whose `time.start` is older than the stale age and that haven't been
 * sweep-notified yet, paired with the ORIGINAL target chat persisted on the card
 * (`target-session`; null → the notifier falls back to most-active, e.g. a legacy
 * card predating the field). Reference is the card's own `time.start`
 * (deterministic under `CB_TIME`), not file mtime (which git operations reset).
 */
async function findStaleTmpUploadCards(opts: { boxRoot: string; now: number }): Promise<UnfiledBatch[]> {
  const { boxRoot, now } = opts;

  const stale: UnfiledBatch[] = [];
  for (const dir of await findTmpUploadDirs(boxRoot, boxRoot)) {
    for (const card of await batchCardsIn(dir)) {
      const parsed = parseUploadBatch(await fs.readFile(card, "utf-8").catch(() => ""));
      if (parsed === null || parsed.frontmatter.status !== "delivered") continue;
      if (parsed.frontmatter["sweep-notified"] !== undefined) continue; // Already surfaced once.
      const startedAt = parsed.frontmatter.time?.start;
      if (startedAt === undefined) continue;
      const ageMs = now - new Date(startedAt).getTime();
      if (ageMs < TMP_UPLOAD_STALE_MS) continue;
      stale.push({
        cardRelPath: path.relative(boxRoot, card),
        sessionId: parsed.frontmatter["target-session"] ?? null,
        ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
      });
    }
  }
  return stale.toSorted((a, b) => a.cardRelPath.localeCompare(b.cardRelPath));
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
