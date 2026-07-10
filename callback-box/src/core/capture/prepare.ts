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
 * Two concurrency guards live at module scope:
 * - `inFlightIds` — a set of staging ids currently being prepared in THIS
 *   process, so a startup resume can't race a live finalize's worker.
 * - `commitChain` — serializes the stage→commit span across workers so two
 *   preparations can't interleave `git add`/`git commit` and commit each
 *   other's files; each commit is additionally pathspec-scoped (`commitPaths`).
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
import { stageFiles, commitPaths, pathsHaveChanges, isNothingToCommitError } from "../../lib/git.js";
import {
  readStagingSession,
  setStagingState,
  setStagingTargetSessionId,
  stagingSessionDir,
  stagingSessionIsEmpty,
  cleanupStagingSession,
} from "./staging-store.js";
import { writeCaptureDocument, sessionBasenameFor, collectTimestamps } from "./write-cards.js";
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
 * Tail of a promise chain serializing every stage→commit span across workers.
 * Two concurrent captures each stage into the shared git index; without
 * serialization a plain `commit` would sweep the OTHER worker's staged files
 * under the wrong message (and the loser hits "nothing to commit"). We both
 * serialize the span AND scope each commit to its own pathspec.
 */
let commitChain: Promise<unknown> = Promise.resolve();

function withCommitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = commitChain.then(fn, fn);
  commitChain = result.then(
    () => {},
    () => {},
  );
  return result;
}

/**
 * Stage + commit exactly the given paths, serialized against every other
 * capture commit and scoped to those paths. Idempotent: no-op when the paths
 * are already clean, and a residual "nothing to commit" race (the box's own
 * auto-sweep beat us to it) is treated as success.
 */
async function commitPathsSerialized(
  boxRoot: string,
  opts: { paths: string[]; message: string; trailers?: Record<string, string> },
): Promise<void> {
  await withCommitLock(async () => {
    if (!(await pathsHaveChanges(boxRoot, opts.paths))) return;
    await stageFiles(boxRoot, opts.paths);
    try {
      await commitPaths(boxRoot, opts);
    } catch (err) {
      if (isNothingToCommitError(err)) return;
      throw err;
    }
  });
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
  const target = await resolveCaptureDeliveryTarget({ boxRoot, targetSessionId: session.targetSessionId });
  if (target.sessionId !== null && target.sessionId !== session.targetSessionId) {
    await setStagingTargetSessionId({ boxRoot, id, targetSessionId: target.sessionId });
  }

  await setStagingState({ boxRoot, id, state: "preparing" });
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "preparing" });

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
    });
  }

  // Step c — transcribe each clip (word timestamps + `.timing.json` sidecars).
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "transcribing" });
  const transcription = await transcribeCaptureClips({ boxRoot, captureAttachDir: sessionAttachAbsDir });
  // ANY clip left untranscribed flags the wrapper — a partial failure otherwise
  // silently under-reports (see the visible per-clip markers in the timeline).
  const transcriptionFailed = transcription.transcribed < transcription.total;
  if (transcription.errors.length > 0) {
    console.warn(
      `[capture] ${transcription.errors.length} clip(s) failed to transcribe for ${basename}: ${transcription.errors.join("; ")}`,
    );
  }

  // Step d — assemble the deterministic timeline body (idempotent).
  await assembleCaptureTimeline({ captureCardPath: sessionCardAbsPath });

  // Step e — validate the written cards before committing.
  const cardPaths = await collectCardPaths(sessionCardAbsPath, sessionAttachAbsDir);
  const summary = await lintCardsDispatch(cardPaths, { boxRoot, ctx: await buildLoadContext(boxRoot) });
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
    await setStagingState({ boxRoot, id, state: "failed:assemble" });
    eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "failed", docPath: sessionCardRelPath });
    return;
  }

  // Step f — commit the capture document (one pathspec-scoped commit, idempotent).
  await commitPathsSerialized(boxRoot, {
    paths: [sessionCardRelPath, sessionAttachRelDir],
    message: `Capture: ${basename}`,
    trailers: { "Created-By": "capture" },
  });

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
      await finishDelivery({ boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId: target.sessionId });
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
      await setStagingState({ boxRoot, id, state: "failed:deliver" });
      eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "failed", docPath: sessionCardRelPath });
      return;
    }
    throw e;
  }

  // An enqueue (agent busy) counts as delivered-for-idempotency: the queue is
  // in-memory only, so a crash before drain loses the notification (accepted —
  // the card is already committed), but marking `delivered` here guarantees a
  // resume never double-enqueues.
  await finishDelivery({ boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId: delivered.sessionId });
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
}): Promise<void> {
  const { boxRoot, id, eventBus, sessionCardAbsPath, sessionCardRelPath, basename, deliveredSessionId } = opts;

  await markCaptureCardDelivered({ boxRoot, sessionCardAbsPath, sessionCardRelPath, basename });

  await setStagingState({ boxRoot, id, state: "delivered" });
  eventBus.emit("capture-status", {
    stagingId: id,
    sessionId: deliveredSessionId,
    status: "delivered",
    docPath: sessionCardRelPath,
  });

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
  let changed = false;
  await withCardLock(sessionCardAbsPath, async () => {
    const content = await fs.readFile(sessionCardAbsPath, "utf-8");
    const parsed = parseCardText(content, { source: sessionCardAbsPath, schemas: await createCardSchemaMap() });
    if (parsed.fields.status !== "new") return; // Already delivered/annotated.
    parsed.fields.status = "delivered";
    await fs.writeFile(sessionCardAbsPath, serializeCardText({ schema: parsed.schema, fields: parsed.fields }));
    changed = true;
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
