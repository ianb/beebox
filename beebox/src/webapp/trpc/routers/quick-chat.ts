import { mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc.js";
import type { TrpcContext } from "../context.js";
import { loadRoutingCandidates, RoutingCatalogError } from "../../../core/chat/routing/catalog.js";
import { routingCandidateSchema, selectRoutingDestination } from "../../../core/chat/routing/policy.js";
import { createJevService, JevError } from "../../../services/jev.js";
import { getOpenRouterKey } from "../../../core/openrouter.js";
import { getBoxTimeISO } from "../../../lib/time.js";
import { errnoCode, toError } from "../../../lib/error-guards.js";
import { writeFileAtomic } from "../../../lib/atomic-write.js";
import { withFileLock } from "../../../lib/file-lock.js";
import { getChatRuntime } from "../../chat-runtime.js";
import { loadLandmarkSummaries } from "../../../core/landmark/summaries.js";
import { loadAgentEngine } from "../../../core/box/config.js";
import { seedFeaturesForNewChat } from "../../../core/landmark/features.js";

const receiptSchema = z.object({ sessionId: z.string().optional(), turnId: z.string().optional(), queued: z.boolean().optional() });
const recordSchema = z.object({
  id: z.string().uuid(), message: z.string(), createdAt: z.string(),
  sourceId: z.string().uuid().optional(),
  candidates: z.array(routingCandidateSchema), selected: routingCandidateSchema,
  probabilities: z.record(z.string(), z.number()), model: z.string(), confidence: z.number(),
  preferenceApplied: z.boolean(),
  delivery: z.object({ session: z.string(), exactSession: z.boolean(), contextDir: z.string(), engine: z.enum(["claude", "codex"]) }).nullable(),
  receipt: receiptSchema.optional(),
});
export type QuickChatRecord = z.infer<typeof recordSchema>;
const prepareSchema = z.object({ id: z.string().uuid(), message: z.string().trim().min(1).max(12000), sourceId: z.string().uuid().optional(), candidateId: z.string().optional() });

function recordPath(boxRoot: string, id: string): string {
  return path.join(boxRoot, ".beebox", "quick-chat", `${id}.json`);
}
async function readRecord(boxRoot: string, id: string): Promise<QuickChatRecord | null> {
  try { return recordSchema.parse(JSON.parse(await readFile(recordPath(boxRoot, id), "utf8"))); }
  catch (error) { if (errnoCode(error) === "ENOENT") return null; throw error; }
}
async function saveRecord(boxRoot: string, record: QuickChatRecord): Promise<void> {
  await writeFileAtomic(recordPath(boxRoot, record.id), { content: JSON.stringify(record), mode: 0o600 });
}
async function locked<T>({ boxRoot, id }: { boxRoot: string; id: string }, run: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(recordPath(boxRoot, id)), { recursive: true });
  return withFileLock({ lockPath: `${recordPath(boxRoot, id)}.lock`, metadata: { purpose: "quick-chat" }, waitMs: 35000 }, run);
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
  const key = ctx.services.jev ? null : await getOpenRouterKey(ctx.boxRoot, { purpose: "quick-chat-routing" });
  if (!ctx.services.jev && !key) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Quick chat needs an OpenRouter key granted to this box. Your message has not been sent." });
  const service = ctx.services.jev ?? createJevService({ apiKey: key ?? "" });
  return service.decide({ state, criteria: Object.fromEntries(state.candidates.map(candidate => [candidate.id, `${candidate.label}: ${candidate.target.kind}. Use the matching candidate in state for its context and rubric.`])) });
}

function routingFailure(error: unknown): never {
  if (error instanceof RoutingCatalogError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  if (error instanceof JevError) throw new TRPCError({ code: "BAD_GATEWAY", message: `${error.message}. Your message has not been sent. Retry, or copy the text into a chat.` });
  throw toError(error);
}

export const quickChatRouter = router({
  prepare: authedProcedure.input(prepareSchema).mutation(async ({ ctx, input }) => locked({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const previous = await readRecord(ctx.boxRoot, input.id);
    if (previous) {
      if (previous.message !== input.message || previous.sourceId !== input.sourceId || (input.candidateId !== undefined && previous.selected.id !== input.candidateId)) throw new TRPCError({ code: "CONFLICT", message: "This send already has different text. Start another message." });
      if (!previous.receipt) { await reserve(ctx, previous); await saveRecord(ctx.boxRoot, previous); }
      return previous;
    }
    const source = input.sourceId ? await readRecord(ctx.boxRoot, input.sourceId) : null;
    if (input.sourceId && !source) throw new TRPCError({ code: "NOT_FOUND", message: "Original routing result is unavailable" });
    if (source && source.message !== input.message) throw new TRPCError({ code: "BAD_REQUEST", message: "A correction must resend the original text" });
    const candidates = source?.candidates ?? await loadRoutingCandidates(ctx.boxRoot);
    const judgment = source ?? await judge(ctx, { message: input.message, candidates });
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
  receipt: authedProcedure.input(z.object({ id: z.string().uuid(), receipt: receiptSchema })).mutation(async ({ ctx, input }) => locked({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const record = await readRecord(ctx.boxRoot, input.id);
    if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Routing result is unavailable" });
    if (!record.delivery) throw new TRPCError({ code: "BAD_REQUEST", message: "This routing result has no delivery" });
    if (input.receipt.sessionId && record.delivery.session !== "new" && input.receipt.sessionId !== record.delivery.session) throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt must name the selected conversation" });
    record.receipt = { ...record.receipt, ...input.receipt };
    await saveRecord(ctx.boxRoot, record);
    return { ok: true };
  })),
});
