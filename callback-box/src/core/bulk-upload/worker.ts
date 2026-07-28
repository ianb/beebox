/**
 * Bulk-upload prepare→deliver worker (Track 1 of `docs/implemented-plans/bulk-file-upload.md`).
 *
 * Turns a sealed bulk staging session into a committed `upload-batch` document
 * under the target chat's `tmp-upload/`, then delivers an `<upload>` message
 * pointing at it. Modeled on capture's `prepare.ts` runPreparation, minus
 * transcription/timeline: resolve target → prepare (copy + card + manifest +
 * commit) → deliver → mark delivered + clean up staging.
 *
 * Each step is idempotent and persists progress via the staging `state`, so a
 * server restart mid-flight resumes cleanly (`resume.ts`). Delivery is durable:
 * a non-busy send that resolves marks the batch delivered and cleans up staging;
 * a busy-agent enqueue leaves the session in `delivering` so the reconciliation
 * pass (startup + sweep) re-checks the transcript and re-delivers only if the
 * message never landed — never double-delivering when it did.
 */

import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import {
  readStagingSession,
  setStagingState,
  cleanupStagingSession,
  type StagingSessionState,
} from "../capture/staging-store.js";
import {
  deliverUserMessage,
  userMessageAlreadyLanded,
  UserMessageDeliveryError,
} from "../chat/session/deliver-user-message.js";
import { withCardLock } from "../../lib/card-lock.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { prepareBulkBatch, bulkBatchSlug, bulkBatchCardRelPath } from "./prepare.js";
import { buildUploadWrapper, resolveBulkDeliveryTarget } from "./deliver.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface PrepareBulkDeps {
  boxRoot: string;
  id: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}

/** Record a bulk preparation/delivery failure state (best-effort, error paths). */
export async function markBulkPreparationFailed(opts: {
  boxRoot: string;
  id: string;
  state?: StagingSessionState;
}): Promise<void> {
  const state = opts.state ?? "failed:prepare";
  await setStagingState({ boxRoot: opts.boxRoot, id: opts.id, state }).catch((e: unknown) => {
    console.error(`[bulk] Recording ${state} for ${opts.id} failed:`, e);
  });
}

/**
 * Staging ids being prepared in THIS process right now — guards the startup
 * resume / sweep reconciliation against re-firing a session whose worker is
 * already running (both share one Node process, so no cross-process lock).
 */
const inFlightIds = new Set<string>();

/** Prepare + deliver one bulk staging session (idempotent; safe to re-fire). */
export async function prepareAndDeliverBulkBatch(deps: PrepareBulkDeps): Promise<void> {
  const { id } = deps;
  if (inFlightIds.has(id)) {
    console.warn(`[bulk] Preparation of ${id} already in flight; skipping re-fire.`);
    return;
  }
  inFlightIds.add(id);
  try {
    await runBulkPreparation(deps);
  } finally {
    inFlightIds.delete(id);
  }
}

async function runBulkPreparation(deps: PrepareBulkDeps): Promise<void> {
  const { boxRoot, id, eventBus, registry, wireSession } = deps;

  const session = await readStagingSession({ boxRoot, id });
  if (session === null) return; // Cancelled/cleaned up between seal and here.
  if (session.state === "delivered") return; // Already done (idempotent resume).

  const failedItems = session.failedItems ?? [];
  // Nothing actually arrived and nothing failed → nothing worth delivering.
  if (session.files.length === 0 && failedItems.length === 0) {
    await cleanupStagingSession({ boxRoot, id });
    return;
  }

  // No most-active fallback: the batch is bound to a specific chat. A target
  // that no longer resolves is a broken invariant — fail loudly, stay retryable.
  const target =
    session.targetSessionId === null
      ? null
      : await resolveBulkDeliveryTarget({
          boxRoot,
          targetSessionId: session.targetSessionId,
          contextDir: session.contextDir ?? "",
        });
  if (target === null) {
    console.error(`[bulk] Target chat for batch ${id} (session=${session.targetSessionId}) no longer exists; leaving retryable`);
    await markBulkPreparationFailed({ boxRoot, id, state: "failed:deliver" });
    return;
  }

  // At-most-once, probed FIRST: the batch card path is deterministic, so before
  // mutating any state (a `delivering`→`preparing` reset would erase the "we
  // already sent" signal and re-send on the next crash), check whether a prior
  // run's `<upload>` message already landed. If the card exists AND its message
  // is in the transcript, finish the bookkeeping without re-sending — exactly one
  // <upload> ever reaches the chat. A first finalize has no card yet → skipped.
  const contextDir = session.contextDir ?? "";
  const cardRelPath = bulkBatchCardRelPath({ startedAt: session.createdAt, id, contextDir });
  const batchSlug = bulkBatchSlug({ startedAt: session.createdAt, id });
  if (await fileExists(path.join(boxRoot, cardRelPath))) {
    const landed = await userMessageAlreadyLanded({
      boxRoot,
      sessionId: target.sessionId,
      docPath: cardRelPath,
      logPrefix: "bulk",
    });
    if (landed) {
      await finishBulkDelivery({ boxRoot, id, cardRelPath, batchSlug });
      return;
    }
  }

  await setStagingState({ boxRoot, id, state: "preparing" });

  const prepared = await prepareBulkBatch({
    boxRoot,
    id,
    contextDir,
    failedItems,
  });
  if (prepared === null) return; // Session vanished mid-prepare.

  const wrapper = buildUploadWrapper({
    docPath: prepared.cardRelPath,
    fileCount: prepared.counts.received,
    totalBytes: prepared.totalBytes,
    failedCount: prepared.counts.failed,
    summary: prepared.summary,
  });

  // Mark `delivering` BEFORE send/enqueue so a crash between send and the
  // `delivered` write is recoverable via the at-most-once probe above.
  await setStagingState({ boxRoot, id, state: "delivering" });

  let queued: boolean;
  try {
    const delivered = await deliverUserMessage({
      boxRoot,
      registry,
      eventBus,
      wireSession,
      target,
      message: wrapper,
      logPrefix: "bulk",
    });
    queued = delivered.queued;
  } catch (e) {
    if (e instanceof UserMessageDeliveryError) {
      console.error(`[bulk] Delivery failed for batch ${prepared.batchSlug}:`, e);
      await markBulkPreparationFailed({ boxRoot, id, state: "failed:deliver" });
      return;
    }
    throw e;
  }

  // Busy agent → the message is in the in-memory queue; leave the session in
  // `delivering` (staging retained) so the reconciliation pass confirms the
  // transcript before cleanup, and re-delivers if a crash lost the queue. A
  // completed non-busy send is durably in the transcript → finish now.
  if (queued) return;
  await finishBulkDelivery({ boxRoot, id, cardRelPath: prepared.cardRelPath, batchSlug: prepared.batchSlug });
}

/**
 * Bookkeeping after an `<upload>` message lands: flip the committed batch card
 * `new` → `delivered`, then discard the staging media. Idempotent.
 */
async function finishBulkDelivery(opts: {
  boxRoot: string;
  id: string;
  cardRelPath: string;
  batchSlug: string;
}): Promise<void> {
  const { boxRoot, id, cardRelPath, batchSlug } = opts;
  await markUploadBatchDelivered({ boxRoot, cardRelPath, batchSlug });
  await setStagingState({ boxRoot, id, state: "delivered" });
  await cleanupStagingSession({ boxRoot, id });
}

/** True when a file exists at `absPath`. */
async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    return false;
  }
}

/** Flip the committed batch card `new` → `delivered` under the card lock, then
 *  commit that one card. Idempotent: a card already past `new` is left alone. */
async function markUploadBatchDelivered(opts: {
  boxRoot: string;
  cardRelPath: string;
  batchSlug: string;
}): Promise<void> {
  const { boxRoot, cardRelPath, batchSlug } = opts;
  const cardAbsPath = path.join(boxRoot, cardRelPath);
  const changed = await withCardLock(cardAbsPath, async () => {
    const content = await fs.readFile(cardAbsPath, "utf-8");
    const parsed = parseCardText(content, { source: cardAbsPath, schemas: await createCardSchemaMap() });
    if (parsed.fields.status !== "new") return false;
    parsed.fields.status = "delivered";
    await fs.writeFile(cardAbsPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
    return true;
  });
  if (!changed) return;
  await stageAndCommitPaths(boxRoot, {
    paths: [cardRelPath],
    message: `Upload batch delivered: ${batchSlug}`,
    trailers: { "Created-By": "bulk-upload" },
  });
}
