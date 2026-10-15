/** Owner-scoped retained capture state and explicit recovery actions. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../procedures.js";
import type { TrpcContext } from "../context.js";
import { quickCaptureCapabilities, QUICK_CAPTURE_STATES, quickCaptureMaterialSchema, QUICK_CAPTURE_SOURCES } from "../../../shared/quick-capture.js";
import { captureDirectory, readCapture, listCaptures, requireCaptureOwner, withCaptureLock, writeCapture, QuickCaptureError, type CaptureRecord } from "../../../core/quick-capture/store.js";
import { processCapture } from "../../../core/quick-capture/worker.js";
import { findCaptureSource, reconcileCaptureSource, reconcileCaptureSourceLocked } from "../../../core/quick-capture/source.js";
import { quickChatView, quickChatViewSchema } from "../../../core/chat/routing/quick-chat-record.js";
import { readQuickChatRecord } from "../../../core/chat/routing/quick-chat-store.js";
import { chooseQuickChat, discardQuickChat } from "../../../core/chat/routing/quick-chat-submit/submit.js";
import { captureWorkerContext } from "../../routes/quick-capture/runtime.js";
import { getBoxTime, getBoxTimeISO } from "../../../lib/time.js";
import { withCardLock } from "../../../lib/card-lock.js";
import { stageAndCommitPaths, getStatus, withBoxGitLock } from "../../../lib/git/core/operations.js";
import { parseRef, resolveRefPath } from "../../../shared/ref-path/core.js";

const id = z.string().uuid().transform(value => value.toLowerCase());
const idInput = z.object({ id });
const quickCaptureViewSchema = z.object({
  id, state: z.enum(QUICK_CAPTURE_STATES), capturedAt: z.string().optional(), source: z.enum(QUICK_CAPTURE_SOURCES).optional(),
  recordingInterrupted: z.literal(true).optional(),
  input: z.string().optional(), material: quickCaptureMaterialSchema.optional(), parentCaptureId: id.optional(),
  sourceRef: z.string().optional(), transcript: z.string().optional(), error: z.string().optional(),
  attempts: z.number(), nextAttemptAt: z.string().optional(), serverAccepted: z.literal(true), delivery: quickChatViewSchema.optional(),
});
function owner(ctx: TrpcContext): string | null {
  if (ctx.user !== null) return ctx.user.email;
  if (ctx.actor === "open") return null;
  throw new TRPCError({ code: "FORBIDDEN", message: "A capture owner identity is required. Re-pair an older device." });
}
function worker(ctx: TrpcContext) { return captureWorkerContext({ boxRoot: ctx.boxRoot, services: ctx.services, owner: owner(ctx) }); }
async function owned(ctx: TrpcContext, captureId: string): Promise<CaptureRecord> {
  const record = await readCapture(ctx.boxRoot, captureId);
  if (record === null) throw new TRPCError({ code: "NOT_FOUND", message: "Capture not found." });
  try { requireCaptureOwner(record, owner(ctx)); }
  catch (error) { if (error instanceof QuickCaptureError) throw new TRPCError({ code: "FORBIDDEN", message: error.message }); throw error; }
  return record;
}
async function requireAvailableSource(ctx: TrpcContext, record: CaptureRecord): Promise<void> {
  const originalId = record.declaration.parentCaptureId ?? record.id;
  await owned(ctx, originalId);
  const original = await reconcileCaptureSource(ctx.boxRoot, originalId);
  if (original === null || record.state === "gone" || original.state === "gone") {
    throw new TRPCError({ code: "NOT_FOUND", message: "The original capture was deleted." });
  }
}
/** A context waiting on its original shares that original's offered choice. */
async function deliveryForCapture(ctx: TrpcContext, record: CaptureRecord) {
  const own = await readQuickChatRecord(ctx.boxRoot, record.id);
  if (own !== null || record.declaration.parentCaptureId === undefined) return own;
  const original = await owned(ctx, record.declaration.parentCaptureId);
  const siblings = (await listCaptures(ctx.boxRoot)).filter(item => item.declaration.parentCaptureId === original.id)
    .toSorted((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
  for (const predecessor of [original, ...siblings]) {
    if (predecessor.id === record.id) break;
    const delivery = await readQuickChatRecord(ctx.boxRoot, predecessor.id);
    if (delivery?.state === "needs-choice" || delivery?.state === "sending") return delivery;
  }
  return null;
}
async function sourceStatus(ctx: TrpcContext, record: CaptureRecord): Promise<{ref: string | null; gone: boolean}> {
  const parentId = record.declaration.parentCaptureId;
  const original = parentId === undefined ? record : await readCapture(ctx.boxRoot, parentId) ?? record;
  const reconciled = await reconcileCaptureSource(ctx.boxRoot, original.id) ?? original;
  const ref = reconciled.sourceCommitted === true && reconciled.state !== "gone" ? reconciled.sourceRef ?? null : null;
  return { ref, gone: reconciled.state === "gone" || (reconciled.sourceCommitted === true && ref === null) };
}
async function view(ctx: TrpcContext, record: CaptureRecord): Promise<z.infer<typeof quickCaptureViewSchema>> {
  const declaration = record.declaration;
  const { ref, gone } = await sourceStatus(ctx, record);
  const ownGone = record.state === "gone";
  const contextGone = gone && declaration.parentCaptureId !== undefined && !ownGone;
  const delivery = await deliveryForCapture(ctx, record);
  const result: z.infer<typeof quickCaptureViewSchema> = {
    id: record.id, state: ownGone ? "gone" : contextGone ? "blocked" : gone ? "gone" : record.state,
    ...(record.discardedBeforeAcceptance === true ? {} : { capturedAt: declaration.capturedAt }),
    ...(declaration.source === undefined ? {} : { source: declaration.source }),
    ...(declaration.recordingInterrupted === undefined ? {} : { recordingInterrupted: declaration.recordingInterrupted }),
    ...(declaration.input === undefined ? {} : { input: declaration.input }),
    ...(declaration.material === undefined ? {} : { material: declaration.material }),
    ...(declaration.parentCaptureId === undefined ? {} : { parentCaptureId: declaration.parentCaptureId }),
    ...(ref === null ? {} : { sourceRef: ref }),
    ...(record.transcript === undefined ? {} : { transcript: record.transcript }),
    ...(contextGone ? { error: "The original capture was deleted. Your context words are kept; copy them into a new capture if needed." }
      : record.error === undefined ? {} : { error: record.error }),
    attempts: record.attempts, ...(record.nextAttemptAt === undefined ? {} : { nextAttemptAt: record.nextAttemptAt }), serverAccepted: true,
    ...(delivery === null ? {} : { delivery: quickChatView(delivery, getBoxTime(ctx.boxRoot).getTime()) }),
  };
  if (gone || ownGone) redactSource(result, contextGone);
  return result;
}

function redactSource(result: z.infer<typeof quickCaptureViewSchema>, preserveContext: boolean): void {
  if (!preserveContext) delete result.input;
  delete result.material; delete result.sourceRef; delete result.transcript; delete result.delivery;
}
export const quickCaptureRouter = router({
  capabilities: authedProcedure.query(() => quickCaptureCapabilities),
  list: authedProcedure.output(z.object({ captures: z.array(quickCaptureViewSchema) })).query(async ({ ctx }) => {
    const records = (await listCaptures(ctx.boxRoot)).filter(record => record.owner === owner(ctx) && record.discardedBeforeAcceptance !== true);
    const captures = [];
    for (const record of records) captures.push(await view(ctx, record));
    return { captures };
  }),
  detail: authedProcedure.input(idInput).output(quickCaptureViewSchema).query(async ({ ctx, input }) => view(ctx, await owned(ctx, input.id))),
  retry: authedProcedure.input(idInput).output(quickCaptureViewSchema).mutation(async ({ ctx, input }) => {
    const record = await owned(ctx, input.id);
    await requireAvailableSource(ctx, record);
    await processCapture({ ...worker(ctx), manualRetry: true }, record.id);
    return view(ctx, await owned(ctx, record.id));
  }),
  choose: authedProcedure.input(z.object({ id, candidateId: z.string().min(1) })).output(quickCaptureViewSchema).mutation(async ({ ctx, input }) => {
    const record = await owned(ctx, input.id);
    await requireAvailableSource(ctx, record);
    const offered = await deliveryForCapture(ctx, record);
    if (offered === null) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This capture has no pending destination choice." });
    await owned(ctx, offered.id);
    if (offered.state === "needs-choice") await processCapture(worker(ctx), offered.id);
    await chooseQuickChat(worker(ctx), { id: offered.id, candidateId: input.candidateId });
    await processCapture(worker(ctx), offered.id);
    if (offered.id !== input.id) await processCapture(worker(ctx), input.id);
    return view(ctx, await owned(ctx, input.id));
  }),
  delete: authedProcedure.input(idInput).output(quickCaptureViewSchema).mutation(async ({ ctx, input }) => {
    const requestingOwner = owner(ctx);
    await withCaptureLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
      const existing = await readCapture(ctx.boxRoot, input.id);
      const now = getBoxTimeISO(ctx.boxRoot);
      const record: CaptureRecord = existing ?? { id: input.id, owner: requestingOwner, digest: "discarded-before-acceptance",
        declaration: { version: 1, capturedAt: now }, acceptedAt: now, state: "gone", attempts: 0, discardedBeforeAcceptance: true };
      if (existing !== null) await owned(ctx, input.id);
      await reconcileCaptureSourceLocked(ctx.boxRoot, record);
      const ref = record.declaration.parentCaptureId === undefined && record.sourceCommitted === true
        ? await findCaptureSource(ctx.boxRoot, record) ?? (record.state === "gone" ? record.sourceRef ?? null : null) : null;
      // Tombstone first: a crash cannot make a stale upload resurrect the deleted source.
      if (ref !== null) record.sourceRef = ref;
      record.state = "gone"; delete record.nextAttemptAt;
      await writeCapture(ctx.boxRoot, record);
      await fs.rm(path.join(captureDirectory(ctx.boxRoot, record.id), "material"), { force: true });
      const delivery = await readQuickChatRecord(ctx.boxRoot, record.id);
      if (delivery !== null) await discardQuickChat({ boxRoot: ctx.boxRoot }, { id: record.id });
      if (ref !== null) {
        const rel = resolveRefPath({ fromPath: undefined, ref: parseRef(ref).path, kind: "card" });
        if (rel === null) throw new TRPCError({ code: "CONFLICT", message: "Invalid source reference." });
        const attach = rel.replace(/\.memo\.card$/, ".attach");
        await withCardLock(path.join(ctx.boxRoot, rel), () => withBoxGitLock(ctx.boxRoot, async () => {
          await fs.rm(path.join(ctx.boxRoot, rel), { force: true });
          await fs.rm(path.join(ctx.boxRoot, attach), { recursive: true, force: true });
          const status = await getStatus(ctx.boxRoot);
          const changed = [...status.staged, ...status.modified];
          const tracked = [rel, attach].filter(target => changed.some(candidate => candidate === target || candidate.startsWith(`${target}/`)));
          if (tracked.length > 0) await stageAndCommitPaths(ctx.boxRoot, { paths: tracked, message: "Delete retained quick capture" });
        }));
      }
    });
    return view(ctx, await owned(ctx, input.id));
  }),
});
