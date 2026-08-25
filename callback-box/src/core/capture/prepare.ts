/**
 * Capture preparation worker (Track 3).
 *
 * Turns a sealed staging session into a committed capture document under the
 * target chat's `tmp-capture/`, then delivers a `<capture>` message pointing at
 * it. Each step is idempotent — it checks for its own output before redoing
 * work and persists progress via the staging session's `state` — so a server
 * restart mid-preparation resumes cleanly (see `resume.ts`).
 *
 * Pipeline: resolve destination → write cards → transcribe clips (word
 * timestamps + `.timing.json` sidecars) → assemble the timeline body → validate
 * the written cards → commit → deliver. Transcription is deterministic in tests
 * via the `fake` service, so the whole worker doctests end-to-end.
 *
 * One concurrency guard lives at module scope: `inFlightIds`, a set of staging
 * ids currently being prepared in THIS process, so a startup resume can't race
 * a live finalize's worker. Serializing the stage→commit span used to be this
 * module's job too (a bespoke promise chain); it now comes from the box git
 * lock that `stageAndCommitPaths` holds, which covers every writer on the box
 * rather than only concurrent captures.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { buildLoadContext } from "../load-context.js";
import { lintCardsDispatch } from "../card-lint.js";
import { parseCardText, serializeCardText } from "../card-io.js";
import { createCardSchemaMap } from "../../schemas/registry.js";
import { withCardLock } from "../../lib/card-lock.js";
import { stageAndCommitPaths } from "../../lib/git.js";
import {
  readStagingSession,
  setStagingState,
  setStagingTargetSessionId,
  stagingSessionDir,
  stagingSessionIsEmpty,
  type StagingSessionState,
} from "./staging-store.js";
import { cleanupStagingSession } from "./staging-teardown.js";
import {
  writeCaptureDocument,
  sessionBasenameFor,
  collectTimestamps,
  recordTranscriptionOutcome,
} from "./write-cards.js";
import { transcribeCaptureClips } from "./transcribe-clips.js";
import { assembleCaptureTimeline } from "./timeline.js";
import {
  buildCaptureWrapper,
  summarizeCapture,
  deliverCaptureMessage,
  resolveCaptureDeliveryTarget,
  captureMessageAlreadyLanded,
  CaptureDeliveryError,
} from "./deliver.js";

/**
 * Record a capture preparation failure AND emit the `capture-status`
 * `failed` event, so the pending bubble flips to its failed/retry state instead
 * of going stale. Every `.catch` fire-path (finalize route, resume scan, sweep)
 * and every in-worker failure branch routes through here — setting the state
 * without emitting was the bug (X5): the bubble stayed "preparing" forever.
 * The state write is best-effort (a failed capture whose disk write also fails
 * is logged, not thrown) because this runs on error paths that must not mask the
 * original failure.
 */
export async function markCapturePreparationFailed(opts: {
  boxRoot: string;
  id: string;
  eventBus: EventBus;
  state?: StagingSessionState | undefined;
  docPath?: string | undefined;
}): Promise<void> {
  const { boxRoot, id, eventBus, docPath } = opts;
  const state = opts.state ?? "failed:prepare";
  await setStagingState({ boxRoot, id, state }).catch((e: unknown) => {
    console.error(`[capture] Recording ${state} for ${id} failed:`, e);
  });
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "failed", docPath });
}

export interface PrepareCaptureDeps {
  boxRoot: string;
  id: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}

/**
 * Staging ids being prepared in THIS process right now. Guards against the
 * startup resume scan re-firing a session whose finalize-triggered worker is
 * already running (both share one Node process, so no cross-process lock).
 */
const inFlightIds = new Set<string>();

/**
 * Wall-clock per-step timing for one preparation run. Marks accumulate as
 * (step, elapsed-since-previous-mark) spans; `report` writes one summary line
 * to `.callback-box/capture-timing.log` under the box (and stdout).
 * Measurement instrumentation for the capture-latency work.
 */
class StepTimer {
  private readonly spans: Array<[string, number]> = [];
  private readonly t0 = performance.now();
  private last = this.t0;

  mark(step: string): void {
    const now = performance.now();
    this.spans.push([step, now - this.last]);
    this.last = now;
  }

  report(opts: { boxRoot: string; id: string; outcome: string }): void {
    const total = performance.now() - this.t0;
    const parts = this.spans.map(([s, ms]) => `${s}=${ms.toFixed(0)}ms`).join(" ");
    const line = `${new Date().toISOString()} id=${opts.id} outcome=${opts.outcome} total=${total.toFixed(0)}ms ${parts}`;
    console.log(`[capture] timing ${line}`);
    const logPath = path.join(opts.boxRoot, ".callback-box", "capture-timing.log");
    void fs
      .mkdir(path.dirname(logPath), { recursive: true })
      .then(() => fs.appendFile(logPath, line + "\n"))
      .catch((e: unknown) => {
        console.warn("[capture] Failed to write capture-timing.log:", e);
      });
  }
}

/**
 * Stage + commit exactly the given paths. Serialization is no longer this
 * module's job: `stageAndCommitPaths` holds the box git lock across its whole
 * span (`lib/git-lock.ts`), which serializes concurrent captures against each
 * other AND against every other writer on the box — the bespoke promise chain
 * that used to live here only covered the first. It also supplies the
 * idempotency (no-op when the paths are already clean, "nothing to commit"
 * race treated as success) and the staged-only commit scoping that keeps a
 * fully-gitignored attach scope (post-annex boxes) from failing the commit
 * pathspec.
 */
async function commitPathsSerialized(
  boxRoot: string,
  opts: { paths: string[]; message: string; trailers?: Record<string, string> },
): Promise<void> {
  await stageAndCommitPaths(boxRoot, opts);
}

/**
 * Prepare and deliver one staged capture session. Expected failures
 * (validation, delivery) are recorded as `failed:<step>` on the staging session
 * and returned quietly; unexpected errors propagate to the caller's `.catch`.
 */
export async function prepareCaptureSession(deps: PrepareCaptureDeps): Promise<void> {
  const { id } = deps;
  if (inFlightIds.has(id)) {
    console.warn(`[capture] Preparation of ${id} already in flight; skipping re-fire.`);
    return;
  }
  inFlightIds.add(id);
  try {
    await runPreparation(deps);
  } finally {
    inFlightIds.delete(id);
  }
}

async function runPreparation(deps: PrepareCaptureDeps): Promise<void> {
  const { boxRoot, id, eventBus, registry, wireSession } = deps;
  const timer = new StepTimer();

  const session = await readStagingSession({ boxRoot, id });
  if (session === null) return; // Cancelled/cleaned up between seal and here.
  if (session.state === "delivered") return; // Already done (idempotent resume).

  if (stagingSessionIsEmpty(session)) {
    await cleanupStagingSession({ boxRoot, id });
    return;
  }

  // The state we resumed INTO. `delivering` means a prior run had already
  // committed the doc and was about to (or did) send — the at-most-once probe
  // below decides whether the message actually landed.
  const priorState = session.state;

  // Resolve the delivery target ONCE, before writing cards, so placement
  // (`tmp-capture/` under the target's contextDir) and delivery agree. Persist
  // a concrete resolved id so a retry reuses it rather than re-resolving.
  const target = await resolveCaptureDeliveryTarget({ boxRoot, registry, targetSessionId: session.targetSessionId });
  if (target.sessionId !== null && target.sessionId !== session.targetSessionId) {
    await setStagingTargetSessionId({ boxRoot, id, targetSessionId: target.sessionId });
  }

  await setStagingState({ boxRoot, id, state: "preparing" });
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "preparing" });
  timer.mark("setup");

  const captureRelDir =
    target.contextDir !== null && target.contextDir !== "" ? `${target.contextDir}/tmp-capture` : "tmp-capture";
  const sessionDir = stagingSessionDir(boxRoot, id);

  const timestamps = collectTimestamps(session).toSorted();
  const actualStartedAt = timestamps[0] ?? session.createdAt;
  const endedAt = timestamps[timestamps.length - 1] ?? actualStartedAt;
  const basename = sessionBasenameFor({ actualStartedAt, id });

  const sessionCardRelPath = `${captureRelDir}/${basename}.capture-session.card`;
  const sessionCardAbsPath = path.join(boxRoot, sessionCardRelPath);
  const sessionAttachRelDir = `${captureRelDir}/${basename}.attach`;
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);

  // Step b — write the capture document (skip if already written).
  const alreadyWritten = await fileExists(sessionCardAbsPath);
  if (!alreadyWritten) {
    await writeCaptureDocument({
      boxRoot,
      session,
      sessionDir,
      destRelDir: captureRelDir,
      basename,
      actualStartedAt,
      endedAt,
      partial: session.partial === true,
    });
  }
  timer.mark("write-cards");

  // Step c — transcribe each clip (word timestamps + `.timing.json` sidecars).
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "transcribing" });
  const transcription = await transcribeCaptureClips({ boxRoot, captureAttachDir: sessionAttachAbsDir });
  timer.mark("transcribe");
  // ANY clip left untranscribed flags the wrapper — a partial failure otherwise
  // silently under-reports (see the visible per-clip markers in the timeline).
  const transcriptionFailed = transcription.transcribed < transcription.total;
  if (transcription.errors.length > 0) {
    console.warn(
      `[capture] ${transcription.errors.length} clip(s) failed to transcribe for ${basename}: ${transcription.errors.join("; ")}`,
    );
  }

  // Record the transcription outcome on the card itself. The wrapper's flag
  // lives only in the chat transcript, which scrolls away — and a capture that
  // never touched chat has no wrapper at all — so an agent annotating the card
  // later needs the flag in frontmatter (the capture-session schema documents
  // it, and the audio schema sends readers here). Written before the timeline
  // so step d's frontmatter-verbatim rewrite carries it, and before validation
  // so the schema check covers it.
  await recordTranscriptionOutcome({ sessionCardAbsPath, transcriptionFailed });

  // Step d — assemble the deterministic timeline body (idempotent).
  await assembleCaptureTimeline({ captureCardPath: sessionCardAbsPath });
  timer.mark("timeline");

  // Step e — validate the written cards before committing.
  const cardPaths = await collectCardPaths(sessionCardAbsPath, sessionAttachAbsDir);
  const summary = await lintCardsDispatch(cardPaths, { boxRoot, ctx: await buildLoadContext(boxRoot) });
  timer.mark("validate");
  if (summary.totalErrors > 0) {
    const detail = summary.results
      .filter((r) => r.errors.length > 0)
      .map((r) => `${r.path}: ${r.errors.map((e) => e.message).join(", ")}`)
      .join(" | ");
    console.error(
      `[capture] Validation failed for box=${boxRoot} session=${id} (${basename}, ${summary.totalErrors} error(s)): ${detail}`,
    );
    // Delete the invalid (uncommitted) cards this run wrote so a re-fire
    // rebuilds from scratch rather than re-validating stale output forever.
    // Staging media is left intact (the re-fire re-reads it).
    await discardWrittenDocument({ sessionCardAbsPath, sessionAttachAbsDir });
    await markCapturePreparationFailed({ boxRoot, id, eventBus, state: "failed:assemble", docPath: sessionCardRelPath });
    return;
  }

  // Step f — commit the capture document (one pathspec-scoped commit, idempotent).
  await commitPathsSerialized(boxRoot, {
    paths: [sessionCardRelPath, sessionAttachRelDir],
    message: `Capture: ${basename}`,
    trailers: { "Created-By": "capture" },
  });
  timer.mark("commit-doc");

  // Step g — deliver the <capture> message (at most once).
  const wrapperSummary = summarizeCapture({
    firstTranscript: transcription.firstTranscript,
    imageCount: session.photos.length,
    firstFileName: session.files[0]?.originalName,
  });
  const wrapper = buildCaptureWrapper({
    docPath: sessionCardRelPath,
    imageCount: session.photos.length,
    audioSeconds: transcription.durationSeconds,
    summary: wrapperSummary,
    partial: session.partial === true,
    transcriptionFailed,
  });

  // Resuming mid-delivery: a prior run may have sent before persisting the
  // `delivered` marker. If the message already landed in the target transcript,
  // finish the bookkeeping without re-sending (no duplicate user message).
  if (priorState === "delivering") {
    const landed = await captureMessageAlreadyLanded({
      boxRoot,
      sessionId: target.sessionId,
      docPath: sessionCardRelPath,
    });
    if (landed) {
      await finishDelivery({ boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId: target.sessionId, timer });
      return;
    }
  }

  // Mark `delivering` BEFORE send/enqueue so a crash between send and the
  // `delivered` write is recoverable via the at-most-once probe above.
  await setStagingState({ boxRoot, id, state: "delivering" });

  let delivered: { sessionId: string | null };
  try {
    delivered = await deliverCaptureMessage({
      boxRoot,
      registry,
      eventBus,
      wireSession,
      target,
      message: wrapper,
      // Persist a freshly-created session's id so a retry reuses it (F7c);
      // for an existing target this fires synchronously with the same id.
      onSessionResolved: (resolvedId) => setStagingTargetSessionId({ boxRoot, id, targetSessionId: resolvedId }),
    });
  } catch (e) {
    if (e instanceof CaptureDeliveryError) {
      console.error(`[capture] Delivery failed for ${basename}:`, e);
      await markCapturePreparationFailed({ boxRoot, id, eventBus, state: "failed:deliver", docPath: sessionCardRelPath });
      return;
    }
    throw e;
  }

  timer.mark("deliver-send");

  // An enqueue (agent busy) counts as delivered-for-idempotency: the queue is
  // in-memory only, so a crash before drain loses the notification (accepted —
  // the card is already committed), but marking `delivered` here guarantees a
  // resume never double-enqueues.
  await finishDelivery({ boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId: delivered.sessionId, timer });
}

/**
 * Bookkeeping after a message lands: flip the committed capture card
 * `new` → `delivered` (durable secondary marker + user-visible truth), record
 * the `delivered` staging state, emit completion, and discard the staging media.
 */
async function finishDelivery(opts: {
  boxRoot: string;
  id: string;
  eventBus: EventBus;
  sessionCardAbsPath: string;
  sessionCardRelPath: string;
  basename: string;
  deliveredSessionId: string | null;
  timer: StepTimer;
}): Promise<void> {
  const { boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId, timer } = opts;

  await markCaptureCardDelivered({ boxRoot, sessionCardAbsPath, sessionCardRelPath, basename });
  timer.mark("mark-delivered");

  await setStagingState({ boxRoot, id, state: "delivered" });
  eventBus.emit("capture-status", {
    stagingId: id,
    sessionId: deliveredSessionId,
    status: "delivered",
    docPath: sessionCardRelPath,
  });
  timer.report({ boxRoot, id, outcome: "delivered" });

  // Only now that delivery landed do we discard the raw staging media.
  await cleanupStagingSession({ boxRoot, id });
}

/**
 * Flip the committed capture card's `status` `new` → `delivered` under the card
 * lock, then commit that one card. Idempotent: a card already past `new` is left
 * untouched (the commit becomes a no-op).
 */
async function markCaptureCardDelivered(opts: {
  boxRoot: string;
  sessionCardAbsPath: string;
  sessionCardRelPath: string;
  basename: string;
}): Promise<void> {
  const { boxRoot, sessionCardAbsPath, sessionCardRelPath, basename } = opts;
  const changed = await withCardLock(sessionCardAbsPath, async () => {
    const content = await fs.readFile(sessionCardAbsPath, "utf-8");
    const parsed = parseCardText(content, { source: sessionCardAbsPath, schemas: await createCardSchemaMap() });
    if (parsed.fields.status !== "new") return false; // Already delivered/annotated.
    parsed.fields.status = "delivered";
    await fs.writeFile(sessionCardAbsPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
    return true;
  });
  if (!changed) return;
  await commitPathsSerialized(boxRoot, {
    paths: [sessionCardRelPath],
    message: `Capture delivered: ${basename}`,
    trailers: { "Created-By": "capture" },
  });
}

/** All `.card` paths in the capture (session card + children), for validation. */
async function collectCardPaths(sessionCardAbsPath: string, attachAbsDir: string): Promise<string[]> {
  const entries = await fs.readdir(attachAbsDir);
  const childCards = entries.filter((f) => f.endsWith(".card")).map((f) => path.join(attachAbsDir, f));
  return [sessionCardAbsPath, ...childCards];
}

/** Remove the (uncommitted) capture card + attach scope this run wrote. */
async function discardWrittenDocument(opts: {
  sessionCardAbsPath: string;
  sessionAttachAbsDir: string;
}): Promise<void> {
  await fs.rm(opts.sessionCardAbsPath, { force: true });
  await fs.rm(opts.sessionAttachAbsDir, { recursive: true, force: true });
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    return false;
  }
}
