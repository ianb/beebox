import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../procedures.js";
import type { TrpcContext } from "../context.js";
import { loadRoutingCandidates, RoutingCatalogError } from "../../../core/chat/routing/catalog.js";
import { selectRoutingDestination } from "../../../core/chat/routing/policy.js";
import { legacyQuickChatRecordSchema, legacyReceiptSchema, quickChatView, quickChatViewSchema, type LegacyQuickChatRecord, type QuickChatRecord as StoredQuickChatRecord, type QuickChatView } from "../../../core/chat/routing/quick-chat-record.js";
import { judgeQuickChat } from "../../../core/chat/routing/quick-chat-judge.js";
import {
  chooseQuickChat, discardQuickChat, submitQuickChat,
  QuickChatDestinationFixedError, QuickChatInvalidChoiceError, QuickChatNotFoundError, QuickChatTextConflictError,
  type QuickChatChat, type QuickChatContext, type QuickChatDeliveryOutcome,
} from "../../../core/chat/routing/quick-chat-submit.js";
import { quickChatHome } from "../../../core/chat/routing/quick-chat-home.js";
import { CHAT_CHANNELS, type ChatChannel } from "../../../shared/chat-channel.js";
import type { SendOutcome } from "../../chat-runtime.js";
import { closedRecordPath, withQuickChatLock } from "../../../core/chat/routing/quick-chat-store.js";
import { JevError } from "../../../services/jev-wire.js";
import { getBoxTime, getBoxTimeISO } from "../../../lib/time.js";
import { errnoCode, toError } from "../../../shared/error-guards.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { getChatRuntime } from "../../chat-runtime.js";
import { loadLandmarkSummaries } from "../../../core/landmark/summaries.js";
import { loadAgentEngine } from "../../../core/box/config.js";
import { seedFeaturesForNewChat } from "../../../core/landmark/features.js";

type QuickChatRecord = LegacyQuickChatRecord;
const prepareSchema = z.object({ id: z.string().uuid(), message: z.string().trim().min(1).max(12000), sourceId: z.string().uuid().optional(), candidateId: z.string().optional() });

async function readRecord(boxRoot: string, id: string): Promise<QuickChatRecord | null> {
  try { return legacyQuickChatRecordSchema.parse(JSON.parse(await readFile(closedRecordPath(boxRoot, id), "utf8"))); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}
async function saveRecord(boxRoot: string, record: QuickChatRecord): Promise<void> {
  await writeFileAtomic(closedRecordPath(boxRoot, record.id), { content: JSON.stringify(record), mode: 0o600 });
}
async function reserve(ctx: TrpcContext, record: QuickChatRecord): Promise<void> {
  const target = record.selected.target;
  if (target.kind !== "new-session") return;
  if (record.selected.landmark) {
    const { summaries } = await loadLandmarkSummaries(ctx.boxRoot);
    if (!summaries.some(landmark => landmark.path === record.selected.landmark?.path && landmark.dir === target.contextDir)) throw new TRPCError({ code: "CONFLICT", message: "The selected landmark is no longer available. Choose another destination." });
  }
  const runtime = getChatRuntime(ctx.boxRoot);
  if (!runtime) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Chat is not running" });
  const engine = record.delivery?.engine ?? await loadAgentEngine(ctx.boxRoot);
  const session = record.delivery?.session ?? randomUUID();
  if (session === "new") return;
  const result = await runtime.registry.reserve({ sessionId: session, contextDir: target.contextDir,
    requestedEngine: engine, seedFeatures: await seedFeaturesForNewChat({ boxRoot: ctx.boxRoot, contextDir: target.contextDir }) });
  // A taken id on retry is the conversation created by this record's first send.
  record.delivery = { session: result.kind === "unsupported" ? "new" : session, exactSession: result.kind !== "unsupported", contextDir: target.contextDir, engine };
}

async function judge(ctx: TrpcContext, state: { message: string; candidates: QuickChatRecord["candidates"] }) {
  const judgment = await judgeQuickChat({ boxRoot: ctx.boxRoot, jev: ctx.services.jev }, state);
  if (judgment === null) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Quick chat needs an OpenRouter key granted to this box. Your message has not been sent." });
  return judgment;
}

function routingFailure(error: unknown): never {
  if (error instanceof RoutingCatalogError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  if (error instanceof JevError) throw new TRPCError({ code: "BAD_GATEWAY", message: `${error.message}. Your message has not been sent. Retry, or copy the text into a chat.` });
  throw toError(error);
}

const idSchema = z.string().uuid();
const channelSchema = z.enum(CHAT_CHANNELS).optional();
const recentChatSchema = z.object({ sessionId: z.string(), label: z.string(), lastActivity: z.string(),
  landmark: z.object({ dir: z.string(), label: z.string(), symbol: z.string().nullable() }) });
export const quickChatHomeSchema = z.object({
  open: z.array(quickChatViewSchema), recentlySent: z.array(quickChatViewSchema),
  recentChats: z.array(recentChatSchema), shortcuts: z.array(z.object({ label: z.string(), to: z.string() })),
});

function deliveryOutcome(outcome: SendOutcome): QuickChatDeliveryOutcome {
  const { body } = outcome;
  if ("deduplicated" in body) return { kind: "duplicate" };
  if ("queued" in body) return { kind: "accepted", queued: true };
  if ("turnId" in body) return { kind: "accepted", queued: false };
  return { kind: "failed", error: body.error };
}

/** The box's chat runtime as quick chat delivers through it: the send route's own target resolution and sender. */
function quickChatChat(ctx: TrpcContext, channel: ChatChannel | undefined): QuickChatChat | undefined {
  const runtime = getChatRuntime(ctx.boxRoot);
  if (runtime === undefined) return undefined;
  return {
    reserve: (opts) => runtime.registry.reserve(opts),
    async deliver({ delivery, messageId, message }) {
      const fresh = delivery.session === "new";
      const resolved = await runtime.resolveSendTarget({ sessionParam: delivery.session, exactSession: delivery.exactSession,
        contextDir: fresh ? delivery.contextDir : undefined, requestSeedFeatures: undefined, ...(fresh ? { engine: delivery.engine } : {}) });
      // 410 is a deleted or deleting chat; 404 an exact session that no longer resumes. Both are gone.
      if (!resolved.ok) return resolved.code === "CHAT_SESSION_UNAVAILABLE" || resolved.status === 404 ? { kind: "gone" } : { kind: "failed", error: resolved.error };
      // A typed thought, framed as the composer frames one, so the sender is attributed.
      return deliveryOutcome(await runtime.sendUserMessage({ target: resolved.target, message: `<typed>${message}</typed>`, messageId, user: ctx.user, channel }));
    },
  };
}

function context(ctx: TrpcContext, channel: ChatChannel | undefined): QuickChatContext {
  return { boxRoot: ctx.boxRoot, jev: ctx.services.jev, chat: quickChatChat(ctx, channel) };
}

function view(record: StoredQuickChatRecord, ctx: TrpcContext): QuickChatView {
  return quickChatView(record, getBoxTime(ctx.boxRoot).getTime());
}

function requestFailure(error: unknown): never {
  if (error instanceof QuickChatTextConflictError || error instanceof QuickChatDestinationFixedError) throw new TRPCError({ code: "CONFLICT", message: error.message });
  if (error instanceof QuickChatNotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  if (error instanceof QuickChatInvalidChoiceError) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  throw toError(error);
}

export const quickChatRouter = router({
  /** Store, route, and deliver one thought. A repeat with the same id returns the stored record, retrying a pending delivery. */
  submit: authedProcedure.input(z.object({ id: idSchema, message: z.string().trim().min(1).max(12000), channel: channelSchema }))
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await submitQuickChat(context(ctx, input.channel), input).catch(requestFailure), ctx)),
  /** Fix the person's chosen destination for a stored thought, and deliver it. */
  choose: authedProcedure.input(z.object({ id: idSchema, candidateId: z.string().min(1), channel: channelSchema }))
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await chooseQuickChat(context(ctx, input.channel), input).catch(requestFailure), ctx)),
  /** End a stored thought that was not sent. */
  discard: authedProcedure.input(z.object({ id: idSchema }))
    .output(quickChatViewSchema)
    .mutation(async ({ ctx, input }) => view(await discardQuickChat({ boxRoot: ctx.boxRoot }, input).catch(requestFailure), ctx)),
  /** What the box screen shows. */
  home: authedProcedure.output(quickChatHomeSchema).query(async ({ ctx }) => quickChatHome(ctx.boxRoot)),
  prepare: authedProcedure.input(prepareSchema).mutation(async ({ ctx, input }) => withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const previous = await readRecord(ctx.boxRoot, input.id);
    if (previous) {
      if (previous.message !== input.message || previous.sourceId !== input.sourceId || (input.candidateId !== undefined && previous.selected.id !== input.candidateId)) throw new TRPCError({ code: "CONFLICT", message: "This send already has different text. Start another message." });
      if (!previous.receipt) { await reserve(ctx, previous); await saveRecord(ctx.boxRoot, previous); }
      return previous;
    }
    const source = input.sourceId ? await readRecord(ctx.boxRoot, input.sourceId) : null;
    if (input.sourceId && !source) throw new TRPCError({ code: "NOT_FOUND", message: "Original routing result is unavailable" });
    if (source && source.message !== input.message) throw new TRPCError({ code: "BAD_REQUEST", message: "A correction must resend the original text" });
    const judgment = source ?? await judge(ctx, { message: input.message, candidates: await loadRoutingCandidates(ctx.boxRoot) });
    const candidates = judgment.candidates;
    const selection = selectRoutingDestination({ candidates, probabilities: judgment.probabilities });
    const selected = input.candidateId && source ? candidates.find(candidate => candidate.id === input.candidateId) : selection.selected;
    if (!selected || (input.candidateId && !source)) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a destination from the original routing result" });
    const record: QuickChatRecord = { id: input.id, message: input.message, createdAt: getBoxTimeISO(ctx.boxRoot),
      ...(input.sourceId ? { sourceId: input.sourceId } : {}), candidates, selected, probabilities: judgment.probabilities, model: judgment.model, confidence: judgment.confidence,
      preferenceApplied: !input.candidateId && selection.preferenceApplied,
      delivery: selected.target.kind === "existing-session" ? { session: selected.target.sessionId, exactSession: true, contextDir: selected.target.contextDir, engine: await loadAgentEngine(ctx.boxRoot) } : null };
    await reserve(ctx, record);
    await saveRecord(ctx.boxRoot, record);
    return record;
  }).catch(routingFailure)),
  receipt: authedProcedure.input(z.object({ id: z.string().uuid(), receipt: legacyReceiptSchema })).mutation(async ({ ctx, input }) => withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const record = await readRecord(ctx.boxRoot, input.id);
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Routing result is unavailable" });
    if (!record.delivery) throw new TRPCError({ code: "BAD_REQUEST", message: "This routing result has no delivery" });
    if (input.receipt.sessionId && record.delivery.session !== "new" && input.receipt.sessionId !== record.delivery.session) throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt must name the selected conversation" });
    record.receipt = { ...record.receipt, ...input.receipt };
    await saveRecord(ctx.boxRoot, record);
    return { ok: true };
  })),
});
