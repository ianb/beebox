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
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { EventBus } from "../event-bus.js";
import type { ChatSession } from "../chat/session/index.js";
import type { ChatSessionRegistry } from "../chat/session/registry.js";
import { getDirectoryForSession } from "../chat/session/history.js";
import { buildLoadContext } from "../load-context.js";
import { lintCardsDispatch } from "../card-lint.js";
import { stageFiles, commit, pathsHaveChanges } from "../../lib/git.js";
import {
  readStagingSession,
  setStagingState,
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
  CaptureDeliveryError,
} from "./deliver.js";

export interface PrepareCaptureDeps {
  boxRoot: string;
  id: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}

/** Resolve the box-relative `tmp-capture/` dir for the capture's target chat. */
async function resolveCaptureDir(
  boxRoot: string,
  targetSessionId: string | null,
): Promise<{ captureRelDir: string; contextDir: string | null }> {
  const contextDir = targetSessionId !== null ? await getDirectoryForSession(boxRoot, targetSessionId) : null;
  const captureRelDir =
    contextDir !== null && contextDir !== "" ? `${contextDir}/tmp-capture` : "tmp-capture";
  return { captureRelDir, contextDir };
}

/** All `.card` paths in the capture (session card + children), for validation. */
async function collectCardPaths(sessionCardAbsPath: string, attachAbsDir: string): Promise<string[]> {
  const entries = await fs.readdir(attachAbsDir);
  const childCards = entries.filter((f) => f.endsWith(".card")).map((f) => path.join(attachAbsDir, f));
  return [sessionCardAbsPath, ...childCards];
}

/**
 * Prepare and deliver one staged capture session. Expected failures
 * (validation, delivery) are recorded as `failed:<step>` on the staging session
 * and returned quietly; unexpected errors propagate to the caller's `.catch`.
 */
export async function prepareCaptureSession(deps: PrepareCaptureDeps): Promise<void> {
  const { boxRoot, id, eventBus, registry, wireSession } = deps;

  const session = await readStagingSession({ boxRoot, id });
  if (session === null) return; // Cancelled/cleaned up between seal and here.
  if (session.state === "delivered") return; // Already done (idempotent resume).

  if (stagingSessionIsEmpty(session)) {
    await cleanupStagingSession({ boxRoot, id });
    return;
  }

  await setStagingState({ boxRoot, id, state: "preparing" });
  eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "preparing" });

  const { captureRelDir, contextDir } = await resolveCaptureDir(boxRoot, session.targetSessionId);
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
  const transcriptionFailed = transcription.total > 0 && transcription.transcribed === 0;
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
    console.error(`[capture] Validation failed for ${basename} (${summary.totalErrors} error(s)): ${detail}`);
    await setStagingState({ boxRoot, id, state: "failed:assemble" });
    eventBus.emit("capture-status", { stagingId: id, sessionId: null, status: "failed", docPath: sessionCardRelPath });
    return;
  }

  // Step f — commit the capture document (one commit, idempotent).
  await commitCaptureDoc({ boxRoot, sessionCardRelPath, sessionAttachRelDir, basename });

  // Step g — deliver the <capture> message.
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

  let delivered: { sessionId: string | null };
  try {
    delivered = await deliverCaptureMessage({
      boxRoot,
      registry,
      eventBus,
      wireSession,
      targetSessionId: session.targetSessionId,
      contextDir,
      message: wrapper,
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

  await setStagingState({ boxRoot, id, state: "delivered" });
  eventBus.emit("capture-status", {
    stagingId: id,
    sessionId: delivered.sessionId,
    status: "delivered",
    docPath: sessionCardRelPath,
  });

  // Only now that delivery landed do we discard the raw staging media.
  await cleanupStagingSession({ boxRoot, id });
}

/** Commit the capture card + attach scope in one commit. No-op if already committed. */
async function commitCaptureDoc(opts: {
  boxRoot: string;
  sessionCardRelPath: string;
  sessionAttachRelDir: string;
  basename: string;
}): Promise<void> {
  const { boxRoot, sessionCardRelPath, sessionAttachRelDir, basename } = opts;
  const paths = [sessionCardRelPath, sessionAttachRelDir];
  if (!(await pathsHaveChanges(boxRoot, paths))) return; // Clean → already committed.
  await stageFiles(boxRoot, paths);
  await commit(boxRoot, {
    message: `Capture: ${basename}`,
    trailers: { "Created-By": "capture" },
  });
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch (_e) {
    return false;
  }
}
