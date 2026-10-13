/** Recoverable source/transcription/routing work, detached from acceptance. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { quickCaptureDeclarationSchema } from "../../shared/quick-capture.js";
import { getBoxTime, getBoxTimeISO } from "../../lib/time.js";
import { mimetypeToExtension } from "../../lib/mimetype.js";
import { errorMessage, errnoCode } from "../../shared/error-guards.js";
import { transcribeAudio } from "../transcription/dispatch/core.js";
import { readQuickChatRecord } from "../chat/routing/quick-chat-store.js";
import { deliveryExpired, type QuickChatRecord } from "../chat/routing/quick-chat-record.js";
import { submitQuickChat, submitQuickChatFollowup, type QuickChatContext } from "../chat/routing/quick-chat-submit/submit.js";
import { materializeCaptureSource, writeSourceTranscription, reconcileCaptureSource } from "./source.js";
import { captureDirectory, listCaptures, readCapture, withCaptureLock, writeCapture, requireCaptureOwner, QuickCaptureError, type CaptureRecord } from "./store.js";

const RETRY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
export interface CaptureWorkerContext extends QuickChatContext {
  transcribe?: typeof transcribeAudio;
  manualRetry?: boolean;
}
async function saveFailure(ctx: CaptureWorkerContext, args: { record: CaptureRecord; error: unknown }): Promise<void> {
  const { record, error } = args;
  if (error instanceof QuickCaptureError && error.reason === "empty-transcript") {
    record.state = "saved"; record.transcriptionTerminal = true; record.error = error.message;
    delete record.nextAttemptAt; await writeCapture(ctx.boxRoot, record); return;
  }
  if (error instanceof QuickCaptureError && error.code === "gone") {
    if (record.declaration.parentCaptureId !== undefined) {
      record.state = "blocked"; record.blockedByGone = true;
      record.error = "The original capture was deleted. Your context words are kept; copy them into a new capture if needed.";
    } else { record.state = "gone"; record.error = error.message; }
    delete record.nextAttemptAt; await writeCapture(ctx.boxRoot, record); return;
  }
  console.error(`[quick-capture] ${record.id} processing failed:`, failureMetadata(error));
  const now = getBoxTime(ctx.boxRoot).getTime();
  const terminal = now - Date.parse(record.acceptedAt) > RETRY_HORIZON_MS;
  record.state = "failed";
  record.error = terminal ? "Automatic retry ended. Your source is retained. Retry explicitly after checking delivery."
    : error instanceof QuickCaptureError ? error.message : "Processing failed. Your capture is retained. Retry to recover it.";
  record.attempts += 1;
  if (!terminal) record.nextAttemptAt = new Date(now + Math.min(3600000, 60000 * 2 ** Math.min(record.attempts, 6))).toISOString();
  else delete record.nextAttemptAt;
  await writeCapture(ctx.boxRoot, record);
}
async function parentDestination(ctx: CaptureWorkerContext, record: CaptureRecord): Promise<{ sourceRef: string; fixed?: Extract<QuickChatRecord, { state: "sent" }>; retainedRecording?: boolean; recordingInterrupted?: boolean; blocked?: string }> {
  const parentId = record.declaration.parentCaptureId;
  if (parentId === undefined) throw new QuickCaptureError({ reason: "context-without-parent" });
  const parent = await reconcileCaptureSource(ctx.boxRoot, parentId);
  if (parent === null || parent.state === "gone") throw new QuickCaptureError({ reason: "parent-gone" });
  requireCaptureOwner(parent, record.owner);
  if (parent.declaration.parentCaptureId !== undefined) throw new QuickCaptureError({ reason: "nested-context" });
  if (parent.sourceCommitted !== true || parent.sourceRef === undefined) return { sourceRef: "", blocked: "Waiting for the original capture to finish saving." };
  const sourceRef = await materializeCaptureSource(ctx.boxRoot, parent);
  const contexts = (await listCaptures(ctx.boxRoot)).filter(item => item.declaration.parentCaptureId === parentId)
    .toSorted((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
  const events = [parent, ...contexts];
  let fixed: Extract<QuickChatRecord, { state: "sent" }> | undefined;
  for (const event of events) {
    if (event.id === record.id) break;
    const delivery = await readQuickChatRecord(ctx.boxRoot, event.id);
    if (delivery?.state === "sent") {
      if (delivery.destination.sessionId === undefined) return { sourceRef, blocked: "Waiting for the original chat to identify itself. Your words are kept. If the box restarted before recording that identity, send them explicitly in the original chat." };
      fixed = delivery;
    }
    else if (delivery?.state === "needs-choice") return { sourceRef, blocked: "Choose a destination for the original capture before sending context." };
    else if (delivery?.state === "sending") return { sourceRef, blocked: deliveryExpired(delivery, getBoxTime(ctx.boxRoot).getTime())
      ? "The original delivery needs to be checked in its chat before sending context." : "Waiting for the original capture's delivery." };
    else if (event.id !== parentId && event.state !== "sent") return { sourceRef, blocked: "Waiting for earlier context to be delivered." };
    else if (event.id === parentId && (parent.state === "failed" || parent.state === "preparing" || parent.state === "accepted")) return { sourceRef, blocked: "The original capture needs recovery before sending context." };
  }
  return { sourceRef, retainedRecording: parent.declaration.material?.kind === "audio", recordingInterrupted: parent.declaration.recordingInterrupted === true,
    ...(fixed === undefined ? {} : { fixed }) };
}
async function prepareVoice(ctx: CaptureWorkerContext, record: CaptureRecord): Promise<void> {
  const material = record.declaration.material;
  if (material?.kind !== "audio" || record.transcript !== undefined || (record.transcriptionTerminal === true && ctx.manualRetry !== true)) return;
  const sourceRef = record.sourceRef;
  if (sourceRef === undefined) throw new QuickCaptureError({ reason: "unsaved-recording" });
  record.transcriptionAttemptedAt = getBoxTimeISO(ctx.boxRoot);
  try {
    const result = await (ctx.transcribe ?? transcribeAudio)({
      boxRoot: ctx.boxRoot, audioBuffer: await fs.readFile(path.join(captureDirectory(ctx.boxRoot, record.id), "material")),
      filename: `recording${mimetypeToExtension(material.mimeType)}`,
    });
    if (result.text.trim() === "") throw new QuickCaptureError({ reason: "empty-transcript" });
    delete record.transcriptionTerminal;
    record.transcript = result.text;
    record.transcriptionLanguage = result.language;
    await writeSourceTranscription({ boxRoot: ctx.boxRoot, sourceRef, text: result.text, language: result.language, attemptedAt: record.transcriptionAttemptedAt });
  } catch (error) {
    await writeSourceTranscription({ boxRoot: ctx.boxRoot, sourceRef, attemptedAt: record.transcriptionAttemptedAt, error: errorMessage(error), permanent: error instanceof QuickCaptureError && error.reason === "empty-transcript" });
    throw error;
  }
}
async function prepareOriginal(ctx: CaptureWorkerContext, record: CaptureRecord): Promise<string | undefined> {
  if (record.declaration.parentCaptureId !== undefined) return undefined;
  record.state = "preparing";
  await writeCapture(ctx.boxRoot, record);
  record.sourceRef = await materializeCaptureSource(ctx.boxRoot, record);
  record.sourceCommitted = true;
  // Source ownership is committed before transcription; a restart cannot recreate a deleted source.
  await writeCapture(ctx.boxRoot, record);
  try { await prepareVoice(ctx, record); }
  catch (error) {
    if (record.declaration.input === undefined || record.declaration.input.trim() === "") throw error;
    console.warn(`[quick-capture] transcription failed for ${record.id}; supplied words still authorize work:`, failureMetadata(error));
    if (error instanceof QuickCaptureError && error.reason === "empty-transcript") record.transcriptionTerminal = true;
    return "Audio is retained, but transcription failed. Retry to transcribe it.";
  }
  return undefined;
}
function automaticRetryExpired(ctx: CaptureWorkerContext, record: CaptureRecord): boolean {
  return ctx.manualRetry !== true && record.state !== "sent" && record.state !== "saved" && record.state !== "needs-choice"
    && getBoxTime(ctx.boxRoot).getTime() - Date.parse(record.acceptedAt) > RETRY_HORIZON_MS;
}
async function processLocked(ctx: CaptureWorkerContext, record: CaptureRecord): Promise<CaptureRecord> {
  let transcriptionProblem: string | undefined;
  try {
    if (automaticRetryExpired(ctx, record)) {
      record.state = "failed"; record.error = "Automatic retry ended. Your capture is retained. Retry explicitly to recover it.";
      delete record.nextAttemptAt; await writeCapture(ctx.boxRoot, record); return record;
    }
    transcriptionProblem = await prepareOriginal(ctx, record);
    const input = record.declaration.input?.trim() || record.transcript?.trim();
    if (input === undefined || input === "") {
      record.state = "saved";
    } else {
      let sourceRef = record.sourceRef;
      let retainedRecording = record.declaration.material?.kind === "audio";
      let recordingInterrupted = record.declaration.recordingInterrupted === true;
      let fixed: Extract<QuickChatRecord, { state: "sent" }> | undefined;
      if (record.declaration.parentCaptureId !== undefined) {
        const parent = await parentDestination(ctx, record);
        if (parent.blocked !== undefined) {
          record.state = "blocked"; record.error = parent.blocked;
          await writeCapture(ctx.boxRoot, record); return record;
        }
        sourceRef = parent.sourceRef; fixed = parent.fixed;
        retainedRecording = parent.retainedRecording === true; recordingInterrupted = parent.recordingInterrupted === true;
        record.sourceRef = sourceRef;
      }
      if (sourceRef === undefined) throw new QuickCaptureError({ reason: "source-unavailable" });
      const prior = await readQuickChatRecord(ctx.boxRoot, record.id);
      if (prior?.state === "sending" && deliveryExpired(prior, getBoxTime(ctx.boxRoot).getTime())) {
        record.state = "failed"; record.error = "This may already be in its chat. Check it before starting a new send.";
        delete record.nextAttemptAt;
        await writeCapture(ctx.boxRoot, record); return record;
      }
      const delivery = fixed === undefined
        ? await submitQuickChat(ctx, { id: record.id, message: input, origin: "external", source: quickCaptureDeclarationSchema.parse(record.declaration).source, sourceRef,
          ...(recordingInterrupted ? { recordingInterrupted: true } : {}),
          captureInputKind: record.declaration.input?.trim() ? "words" : "transcript",
          ...(retainedRecording ? { retainedRecording: true } : {}) })
        : await submitQuickChatFollowup(ctx, { id: record.id, message: input, source: quickCaptureDeclarationSchema.parse(record.declaration).source, sourceRef, parent: fixed });
      record.state = delivery.state === "discarded" ? "saved" : delivery.state;
      if (delivery.state === "sending" && delivery.lastError !== undefined) record.error = delivery.lastError;
      else if (transcriptionProblem !== undefined) record.error = transcriptionProblem;
      else delete record.error;
    }
    delete record.nextAttemptAt;
    await writeCapture(ctx.boxRoot, record);
  } catch (error) { await saveFailure(ctx, { record, error }); }
  return record;
}
export async function processCapture(ctx: CaptureWorkerContext, id: string): Promise<CaptureRecord | null> {
  return withCaptureLock({ boxRoot: ctx.boxRoot, id }, async () => {
    const record = await readCapture(ctx.boxRoot, id);
    if (record === null || record.state === "gone") return record;
    return processLocked(ctx, record);
  });
}
/** Periodic and startup reconciliation; terminal failures need explicit retry. */
export async function recoverCaptures(ctx: CaptureWorkerContext): Promise<void> {
  const now = getBoxTime(ctx.boxRoot).getTime();
  const records = (await listCaptures(ctx.boxRoot)).toSorted((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
  for (const record of records) {
    const automatic = record.state === "accepted" || record.state === "preparing" || record.state === "sending" || (record.state === "blocked" && record.blockedByGone !== true)
      || (record.state === "failed" && record.nextAttemptAt !== undefined && Date.parse(record.nextAttemptAt) <= now);
    if (automatic) await processCapture(ctx, record.id);
  }
}

function failureMetadata(error: unknown): { name: string; code?: string } {
  const code = errnoCode(error);
  return { name: error instanceof Error ? error.name : "UnknownError", ...(code === undefined ? {} : { code }) };
}
