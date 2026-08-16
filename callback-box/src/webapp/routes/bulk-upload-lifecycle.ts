/**
 * Startup + periodic lifecycle wiring for bulk uploads, split out of
 * `bulk-upload.ts` to keep the route file under the line cap.
 *
 * On startup it resumes any bulk batch left mid-flight (reconciliation for a
 * crashed worker or a lost busy-agent notification). It then runs the bulk
 * sweep on an awake-time interval: re-firing stuck batches, surfacing abandoned
 * staging, and turning a ≥7-day unfiled `tmp-upload/` batch into a `<self-note>`
 * to its target chat (the requestless injection precedent from the self-note
 * route — a live registry, no HTTP request).
 */

import type { FastifyInstance } from "fastify";
import type { EventBus } from "../../core/event-bus.js";
import { getMostActive } from "../../core/chat/session/history.js";
import { resumeBulkSessions } from "../../core/bulk-upload/resume.js";
import { sweepBulkBatches, type UnfiledBatch, type StrandedBatch } from "../../core/bulk-upload/sweep.js";
import { prepareAndDeliverBulkBatch, markBulkPreparationFailed } from "../../core/bulk-upload/worker.js";
import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import { getChatRuntime, type ChatRuntime } from "../chat-runtime.js";

/** How much awake time between bulk sweeps (matches capture's cadence). */
const BULK_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/** Inject a `<self-note>` about an unfiled batch into its target chat (or the
 *  most-active session), mirroring the self-note route's busy?enqueue:send. */
async function injectUnfiledSelfNote(opts: {
  boxRoot: string;
  runtime: ChatRuntime;
  batch: UnfiledBatch;
}): Promise<void> {
  const { boxRoot, runtime, batch } = opts;
  const targetId = batch.sessionId ?? (await getMostActive(boxRoot));
  if (!targetId) {
    console.warn(`[bulk] Unfiled batch ${batch.cardRelPath} has no chat to notify (no live session)`);
    return;
  }
  const body =
    `An uploaded file batch has been sitting unfiled in \`${batch.cardRelPath}\` for ${String(batch.ageDays)} day(s). ` +
    "Read the upload-batch card, file its files to their destinations, and delete it when done (or delete it now if it was already handled).";
  const wrapped = `<self-note ref="bulk-upload-sweep">\n${body}\n</self-note>`;

  const session = runtime.registry.getOrCreate(targetId);
  runtime.wireSession(session);
  if (session.isBusy()) {
    session.enqueue({ text: wrapped });
    return;
  }
  runtime.registry.enforceLiveCap(targetId);
  runtime.registry.touch(targetId, { subprocessUse: true });
  const sent = await session.send({ text: wrapped });
  if (!sent) console.error(`[bulk] Self-note send failed for unfiled batch ${batch.cardRelPath}`);
}

/**
 * Hand a sealed-but-undeliverable batch to the chat agent.
 *
 * The uploader is deliberately not the recovery mechanism: once a batch is
 * sealed the box holds both the bytes and the boxholder's introduction, so the
 * box is what must notice — a retry button on a phone that may never return
 * cannot be relied on, and a `console.error` reaches nobody. The note gives the
 * agent what it needs to act: what the boxholder said, how much arrived, and
 * where it is.
 */
async function injectStrandedSelfNote(opts: {
  boxRoot: string;
  runtime: ChatRuntime;
  batch: StrandedBatch;
}): Promise<void> {
  const { boxRoot, runtime, batch } = opts;
  const targetId = batch.targetSessionId ?? (await getMostActive(boxRoot));
  if (!targetId) {
    console.warn(`[bulk] Stranded batch ${batch.sessionId} has no chat to notify (no live session)`);
    return;
  }
  const introduction =
    batch.note === undefined
      ? "They did not say what the files were for."
      : `They said: "${batch.note}"`;
  const body =
    `A file upload the boxholder submitted could not be delivered (${batch.state}). ` +
    `${String(batch.receivedCount)} of ${String(batch.registeredCount)} file(s) reached the box` +
    `${batch.failedCount > 0 ? `, ${String(batch.failedCount)} failed to upload` : ""}; ` +
    `the bytes are still staged under \`tmp/capture-staging/${batch.sessionId}/\`. ${introduction} ` +
    "They have not been told this failed and may believe the upload worked. " +
    "Tell them what happened, and — if you can work out where the files should go from what they " +
    "said — offer to place them. Do not silently discard the batch.";
  const wrapped = `<self-note ref="bulk-upload-stranded">\n${body}\n</self-note>`;

  const session = runtime.registry.getOrCreate(targetId);
  runtime.wireSession(session);
  if (session.isBusy()) {
    session.enqueue({ text: wrapped });
    return;
  }
  runtime.registry.enforceLiveCap(targetId);
  runtime.registry.touch(targetId, { subprocessUse: true });
  const sent = await session.send({ text: wrapped });
  if (!sent) console.error(`[bulk] Self-note send failed for stranded batch ${batch.sessionId}`);
}

/**
 * Run the bulk sweep every {@link BULK_SWEEP_INTERVAL_MS} of *awake* time (never
 * wall time — a plain interval fires instantly after a macOS sleep). Self-rearms;
 * returns a cancel handle wired to server close.
 */
function scheduleBulkSweep(opts: { boxRoot: string; eventBus: EventBus; runtime: ChatRuntime }): () => void {
  const { boxRoot, eventBus, runtime } = opts;
  let timer: AwakeTimeout | null = null;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    await sweepBulkBatches({
      boxRoot,
      firePreparation: (id) => {
        void prepareAndDeliverBulkBatch({
          boxRoot, id, eventBus, registry: runtime.registry, wireSession: runtime.wireSession,
        }).catch(async (err: unknown) => {
          console.error(`[bulk] Swept preparation of ${id} failed:`, err);
          await markBulkPreparationFailed({ boxRoot, id });
        });
      },
      notifyUnfiled: (batch) => {
        void injectUnfiledSelfNote({ boxRoot, runtime, batch }).catch((err: unknown) => {
          console.error(`[bulk] Self-note for unfiled batch ${batch.cardRelPath} failed:`, err);
        });
      },
      notifyStranded: (batch) => {
        void injectStrandedSelfNote({ boxRoot, runtime, batch }).catch((err: unknown) => {
          console.error(`[bulk] Self-note for stranded batch ${batch.sessionId} failed:`, err);
        });
      },
    });
  };

  const arm = (): void => {
    if (stopped) return;
    timer = startAwakeTimeout({
      timeoutMs: BULK_SWEEP_INTERVAL_MS,
      onTimeout: () => {
        void runOnce()
          .catch((err: unknown) => console.error(`[bulk] Sweep failed for box=${boxRoot}:`, err))
          .finally(() => arm());
      },
    });
  };
  arm();
  return () => {
    stopped = true;
    timer?.stop();
  };
}

/**
 * Wire the bulk-upload startup resume + periodic sweep for a box. No-op (with a
 * warning) when the chat runtime isn't ready — resume/delivery need it.
 */
export function startBulkUploadLifecycle(opts: { server: FastifyInstance; boxRoot: string; eventBus: EventBus }): void {
  const { server, boxRoot, eventBus } = opts;
  const runtime = getChatRuntime(boxRoot);
  if (!runtime) {
    console.warn("[bulk] Chat runtime not ready; skipping bulk resume scan + sweep");
    return;
  }

  void resumeBulkSessions({
    boxRoot, eventBus, registry: runtime.registry, wireSession: runtime.wireSession,
  }).catch((err: unknown) => {
    console.error("[bulk] Staging resume scan failed:", err);
  });

  const cancelSweep = scheduleBulkSweep({ boxRoot, eventBus, runtime });
  server.addHook("onClose", async () => {
    cancelSweep();
  });
}
