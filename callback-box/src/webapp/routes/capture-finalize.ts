/**
 * Capture session finalization — turn a staged session's uploaded media into
 * cards in the box inbox.
 *
 * On finalize, a capture-session card lands at `box/inbox/<basename>.capture-session.card`,
 * and its attach scope (`box/inbox/<basename>.attach/`) holds the audio/image/file
 * cards plus their attached media (each child has its own attach scope inside).
 *
 * (Track 3 of the capture-mode plan replaces this inbox path with an in-chat
 * preparation worker — `src/core/capture/prepare.ts`. The route no longer calls
 * `finalizeSession`; this module and `createProcessCapturesTrigger` are retired
 * in Track 7. The card-writing core has moved to `src/core/capture/write-cards.ts`
 * and is shared with the worker.)
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stageFiles, commit } from "../../lib/git.js";
import { createCaptureSessionTemplate } from "../../schemas/capture-session.js";
import { createScheduledScriptTemplate } from "../../schemas/scheduled-script.js";
import {
  SessionBuilder,
  writeAudioCards,
  writeImageCards,
  writeFileCards,
  sessionBasenameFor,
  collectTimestamps,
} from "../../core/capture/write-cards.js";
import type { StagingSession } from "../../core/capture/staging-store.js";
import { stagingSessionDir, cleanupStagingSession } from "../../core/capture/staging-store.js";

interface FinalizeResult {
  cards: string[];
}

/** Commit all staged media + cards in a single commit summarizing the counts. */
async function commitSession(opts: { boxRoot: string; builder: SessionBuilder }): Promise<void> {
  const { boxRoot, builder } = opts;
  if (builder.filesToStage.length === 0) return;
  await stageFiles(boxRoot, builder.filesToStage);
  const parts: string[] = [];
  if (builder.audioRefs.length > 0) parts.push(`${builder.audioRefs.length} audio`);
  if (builder.imageRefs.length > 0) parts.push(`${builder.imageRefs.length} photos`);
  if (builder.fileRefs.length > 0) parts.push(`${builder.fileRefs.length} files`);
  await commit(boxRoot, {
    message: `Capture session: ${parts.join(", ")}`,
    trailers: { "Created-By": "capture" },
  });
}

/**
 * Turn a staged session into cards + a single commit, then clean up the
 * staging directory. Returns the relative paths of the session card(s) created
 * (empty when the session had no media). Pure orchestration; the route handler
 * adapts the HTTP shape and broadcasts.
 */
export async function finalizeSession(opts: {
  session: StagingSession;
  boxRoot: string;
}): Promise<FinalizeResult> {
  const { session, boxRoot } = opts;
  const sessionDir = stagingSessionDir(boxRoot, session.id);

  const isEmpty =
    session.segments.length === 0 && session.photos.length === 0 && session.files.length === 0;
  if (isEmpty) {
    await cleanupStagingSession({ boxRoot, id: session.id });
    return { cards: [] };
  }

  // Compute actual start/end from media timestamps (client-provided), not
  // session creation time — the capture surface may sit open a long time
  // before the user records or shoots.
  const timestamps = collectTimestamps(session).toSorted();
  const actualStartedAt = timestamps[0] || session.createdAt;
  const endedAt = timestamps[timestamps.length - 1] || actualStartedAt;

  const sessionBasename = sessionBasenameFor({ actualStartedAt, id: session.id });
  const inboxRelDir = "box/inbox";
  const sessionAttachRelDir = `${inboxRelDir}/${sessionBasename}.attach`;
  const sessionAttachAbsDir = path.join(boxRoot, sessionAttachRelDir);
  const inboxAbsDir = path.join(boxRoot, inboxRelDir);

  await fs.mkdir(sessionAttachAbsDir, { recursive: true });

  console.log(
    `[capture] Finalizing staging session ${session.id} → ${sessionBasename}: ` +
      `${session.segments.length} segments, ${session.photos.length} photos, ${session.files.length} files`,
  );

  const builder = new SessionBuilder({ boxRoot, sessionAttachRelDir, sessionAttachAbsDir });
  await writeAudioCards({ builder, sessionDir, segments: session.segments });
  await writeImageCards({ builder, sessionDir, photos: session.photos });
  await writeFileCards({ builder, sessionDir, files: session.files });

  const sessionCardFilename = `${sessionBasename}.capture-session.card`;
  const sessionCardContent = createCaptureSessionTemplate({
    sessionId: session.id,
    startedAt: actualStartedAt,
    endedAt,
    imageRefs: builder.imageRefs,
    audioRefs: builder.audioRefs,
    fileRefs: builder.fileRefs,
  });
  const sessionCardPath = path.join(inboxAbsDir, sessionCardFilename);
  await fs.writeFile(sessionCardPath, sessionCardContent);
  builder.filesToStage.push(`${inboxRelDir}/${sessionCardFilename}`);

  await commitSession({ boxRoot, builder });
  await createProcessCapturesTrigger(boxRoot);
  await cleanupStagingSession({ boxRoot, id: session.id });

  const sessionCardRelPath = `${inboxRelDir}/${sessionCardFilename}`;
  console.log(`[capture] Created capture session: ${sessionCardRelPath}`);
  return { cards: [sessionCardRelPath] };
}

/**
 * Create a one-shot scheduled script that triggers process-captures on the next
 * wakeup. Idempotent — skips if the trigger already exists.
 */
async function createProcessCapturesTrigger(boxRoot: string): Promise<void> {
  const triggerPath = path.join(boxRoot, "config/schedules/process-captures.scheduled-script.card");
  try {
    await fs.access(triggerPath);
    console.log("[capture] process-captures trigger already exists, skipping");
    return;
  } catch (_e) {
    // fs.access throwing means the trigger doesn't exist yet — the normal path.
  }

  const content = createScheduledScriptTemplate({
    onWakeup: true,
    once: true,
    lockGroup: "captures",
    runs: "cb procedure run process-captures",
    description: "Process new capture sessions (auto-created by capture finalize)",
  });

  await fs.mkdir(path.dirname(triggerPath), { recursive: true });
  await fs.writeFile(triggerPath, content);
  console.log("[capture] Created process-captures trigger for next wakeup");
}
