/**
 * Store, route, and deliver one quick chat message (docs/plans/box-screen.md,
 * track 1). `submitQuickChat` does all three in one call so a caller that
 * stops after it returns has lost nothing: the record holds the message, and
 * a repeat `submit` or a `choose` finishes the job.
 *
 * Every operation runs under the record's one lock. Delivery goes through the
 * box's shared user-message sender (injected as {@link QuickChatChat}), and
 * the record id is the message id, so a repeated delivery posts once.
 */

import { randomUUID } from "node:crypto";
import type { JevService } from "../../../../services/jev.js";
import { JevError } from "../../../../services/jev-wire.js";
import { getBoxTime } from "../../../../lib/time.js";
import { errorMessage } from "../../../../shared/error-guards.js";
import { loadAgentEngine, type AgentEngine } from "../../../box/config.js";
import { loadLandmarkSummaries } from "../../../landmark/summaries.js";
import { seedFeaturesForNewChat } from "../../../landmark/features.js";
import type { ReserveResult } from "../../session/reserve.js";
import { loadRoutingCandidates, RoutingCatalogError } from "./catalog.js";
import { routingDisposition, selectRoutingDestination, thoughtAsksForNewChat, type RoutingCandidate } from "../policy.js";
import { judgeQuickChat } from "./judge.js";
import {
  deliveryExpired, deliverySessionId, quickChatChoiceIds,
  type QuickChatDelivery, type QuickChatOrigin, type QuickChatPage, type QuickChatSource, type QuickChatReason, type QuickChatRecord, type SendingQuickChatRecord,
} from "../quick-chat-record.js";
import { readQuickChatRecord, saveQuickChatRecord, withQuickChatLock } from "../quick-chat-store.js";

/** What one delivery attempt reports, in the record's terms. */
export type QuickChatDeliveryOutcome =
  | { kind: "accepted"; queued: boolean; sessionId?: string }
  /** The message id was already claimed: the chat has it, with no further detail. */
  | { kind: "duplicate"; sessionId?: string }
  /** The chat was deleted or is no longer available. */
  | { kind: "gone" }
  | { kind: "failed"; error: string };

/** The box's chat runtime, as quick chat needs it. */
export interface QuickChatChat {
  reserve(opts: { sessionId: string; contextDir: string; seedFeatures: Record<string, string>; requestedEngine: AgentEngine }): Promise<ReserveResult>;
  deliver(args: { delivery: QuickChatDelivery; messageId: string; message: string; origin: QuickChatOrigin; source?: QuickChatSource; sourceRef?: string; retainedRecording?: boolean; recordingInterrupted?: boolean; captureInputKind?: "words" | "transcript"; hqService?: string; onSessionAssigned?: (sessionId: string) => Promise<void> }): Promise<QuickChatDeliveryOutcome>;
}

export interface QuickChatContext {
  boxRoot: string;
  jev: JevService | undefined;
  /** Undefined when the box's chat routes are not running. */
  chat: QuickChatChat | undefined;
}

/** A repeated submit whose text differs from the stored message. */
export class QuickChatTextConflictError extends Error {
  constructor() {
    super("This send already has different text. Start another message.");
    this.name = "QuickChatTextConflictError";
  }
}

export class QuickChatNotFoundError extends Error {
  constructor() {
    super("This message is no longer stored.");
    this.name = "QuickChatNotFoundError";
  }
}

/** A choice that the record did not offer: a stale or fabricated candidate id. */
export class QuickChatInvalidChoiceError extends Error {
  constructor() {
    super("Choose one of the offered destinations.");
    this.name = "QuickChatInvalidChoiceError";
  }
}

/** A choice for a message whose destination is already fixed elsewhere. */
export class QuickChatDestinationFixedError extends Error {
  constructor(label: string) {
    super(`This message is already going to ${label}.`);
    this.name = "QuickChatDestinationFixedError";
  }
}

const GENERAL_CANDIDATE: RoutingCandidate = { id: "general", label: "New general chat", target: { kind: "new-session", contextDir: "" } };
const CHAT_NOT_RUNNING = "Chat is not running on the box. Retry in a moment.";

type RecordBase = Pick<QuickChatRecord, "id" | "message" | "createdAt" | "origin" | "source" | "sourceRef" | "retainedRecording" | "recordingInterrupted" | "captureInputKind" | "hqService" | "page" | "candidates" | "probabilities" | "model" | "confidence" | "preferenceApplied">;

function baseOf(record: QuickChatRecord): RecordBase {
  const { id, message, createdAt, origin, source, sourceRef, retainedRecording, recordingInterrupted, captureInputKind, hqService, page, candidates, probabilities, model, confidence, preferenceApplied } = record;
  return {
    id, message, createdAt, origin, ...(source === undefined ? {} : { source }), ...(sourceRef === undefined ? {} : { sourceRef }), ...(retainedRecording === undefined ? {} : { retainedRecording }), ...(recordingInterrupted === undefined ? {} : { recordingInterrupted }), ...(captureInputKind === undefined ? {} : { captureInputKind }), ...(hqService === undefined ? {} : { hqService }),
    ...(page === undefined ? {} : { page }),
    candidates, probabilities,
    ...(model === undefined ? {} : { model }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(preferenceApplied === undefined ? {} : { preferenceApplied }),
  };
}

/** Ask the person. When every candidate is excluded, a plain new general chat is still offered. */
function needsChoice(base: RecordBase, { reason, exclude }: { reason: QuickChatReason; exclude?: string }): QuickChatRecord {
  const choices = quickChatChoiceIds({ candidates: base.candidates, probabilities: base.probabilities, ...(exclude === undefined ? {} : { exclude }) });
  if (choices.length > 0) return { ...base, state: "needs-choice", reason, choices };
  return { ...base, candidates: [...base.candidates, GENERAL_CANDIDATE], state: "needs-choice", reason, choices: [GENERAL_CANDIDATE.id] };
}

async function save(boxRoot: string, record: QuickChatRecord): Promise<QuickChatRecord> {
  await saveQuickChatRecord(boxRoot, record);
  return record;
}

/** Fix a destination: the record names it, and its session when one exists, before delivery starts. */
async function startSending(ctx: QuickChatContext, { base, selected }: { base: RecordBase; selected: RoutingCandidate }): Promise<QuickChatRecord> {
  const delivery = selected.target.kind === "existing-session"
    ? { session: selected.target.sessionId, exactSession: true, contextDir: selected.target.contextDir, engine: await loadAgentEngine(ctx.boxRoot) }
    : null;
  const sessionId = deliverySessionId(delivery);
  const record: SendingQuickChatRecord = { ...base, state: "sending", selected, delivery,
    destination: { label: selected.label, ...(sessionId === undefined ? {} : { sessionId }) },
    deliveryStartedAt: getBoxTime(ctx.boxRoot).toISOString() };
  return attemptDelivery(ctx, record);
}

/** Reserve a new chat's session (again after a restart: reservations are in memory). Null when its landmark is gone. */
async function reserveNewChat(ctx: QuickChatContext & { chat: QuickChatChat }, record: SendingQuickChatRecord): Promise<SendingQuickChatRecord | null> {
  const { selected } = record;
  if (selected.target.kind !== "new-session") return record;
  const { contextDir } = selected.target;
  if (selected.landmark !== undefined) {
    const { summaries } = await loadLandmarkSummaries(ctx.boxRoot);
    if (!summaries.some(landmark => landmark.path === selected.landmark?.path && landmark.dir === contextDir)) return null;
  }
  const engine = record.delivery?.engine ?? await loadAgentEngine(ctx.boxRoot);
  const session = record.delivery?.session ?? randomUUID();
  if (session === "new") return record;
  const result = await ctx.chat.reserve({ sessionId: session, contextDir, requestedEngine: engine,
    seedFeatures: await seedFeaturesForNewChat({ boxRoot: ctx.boxRoot, contextDir }) });
  // A taken id on retry is the conversation created by this record's first send.
  const delivery = { session: result.kind === "unsupported" ? "new" : session, exactSession: result.kind !== "unsupported", contextDir, engine };
  const sessionId = deliverySessionId(delivery);
  return { ...record, delivery, destination: { label: record.destination.label, ...(sessionId === undefined ? {} : { sessionId }) } };
}

async function attemptDelivery(ctx: QuickChatContext, current: SendingQuickChatRecord): Promise<QuickChatRecord> {
  const now = getBoxTime(ctx.boxRoot).getTime();
  // Past the window the message-id claim may have expired: a delivery could post a second copy.
  if (deliveryExpired(current, now)) return current;
  const { lastError: _previousError, ...record } = current;
  const { chat } = ctx;
  if (chat === undefined) return save(ctx.boxRoot, { ...record, lastError: CHAT_NOT_RUNNING });
  const reserved = await reserveNewChat({ ...ctx, chat }, record);
  if (reserved === null) return save(ctx.boxRoot, needsChoice(baseOf(record), { reason: "destination-gone", exclude: record.selected.id }));
  const { delivery } = reserved;
  if (delivery === null) return save(ctx.boxRoot, { ...reserved, lastError: CHAT_NOT_RUNNING });
  // The destination is on disk before delivery: a duplicate answer carries no outcome to recover it from.
  await saveQuickChatRecord(ctx.boxRoot, reserved);
  let outcome: QuickChatDeliveryOutcome;
  try {
    outcome = await chat.deliver({ delivery, messageId: record.id, message: record.message, origin: record.origin,
      ...(record.source === undefined ? {} : { source: record.source }), ...(record.sourceRef === undefined ? {} : { sourceRef: record.sourceRef }), ...(record.retainedRecording === undefined ? {} : { retainedRecording: record.retainedRecording }), ...(record.recordingInterrupted === undefined ? {} : { recordingInterrupted: record.recordingInterrupted }), ...(record.captureInputKind === undefined ? {} : { captureInputKind: record.captureInputKind }), ...(record.hqService === undefined ? {} : { hqService: record.hqService }),
      ...(record.sourceRef === undefined ? {} : { onSessionAssigned: async (sessionId: string) => bindQuickChatSession(ctx.boxRoot, { id: record.id, sessionId }) }) });
  } catch (error) {
    console.error(`[quick-chat] delivery of ${record.id} failed:`, error);
    outcome = { kind: "failed", error: errorMessage(error) };
  }
  const sentAt = getBoxTime(ctx.boxRoot).toISOString();
  const { deliveryStartedAt, selected, destination } = reserved;
  switch (outcome.kind) {
    case "accepted":
    case "duplicate":
      return save(ctx.boxRoot, { ...baseOf(record), state: "sent", selected,
        delivery: outcome.sessionId === undefined ? delivery : { ...delivery, session: outcome.sessionId, exactSession: true },
        destination: outcome.sessionId === undefined ? destination : { ...destination, sessionId: outcome.sessionId }, deliveryStartedAt, sentAt,
        ...(outcome.kind === "accepted" && outcome.queued ? { queued: true } : {}) });
    case "gone":
      return save(ctx.boxRoot, needsChoice(baseOf(record), { reason: "destination-gone", exclude: selected.id }));
    case "failed":
      return save(ctx.boxRoot, { ...reserved, lastError: outcome.error });
  }
}

/** Judge a new message: post it, ask about it, or, when routing is unavailable, offer recent chats. */
async function route(ctx: QuickChatContext, base: Pick<RecordBase, "id" | "message" | "createdAt" | "origin" | "source" | "sourceRef" | "retainedRecording" | "recordingInterrupted" | "captureInputKind" | "hqService" | "page">): Promise<QuickChatRecord> {
  let candidates: RoutingCandidate[];
  try { candidates = await loadRoutingCandidates(ctx.boxRoot); }
  catch (error) {
    if (!(error instanceof RoutingCatalogError)) throw error;
    console.warn(`[quick-chat] routing catalog unavailable for ${base.id}: ${error.message}`);
    return needsChoice({ ...base, candidates: [GENERAL_CANDIDATE], probabilities: {} }, { reason: "routing-unavailable" });
  }
  let judgment: Awaited<ReturnType<typeof judgeQuickChat>>;
  try { judgment = await judgeQuickChat(ctx, { message: base.message, ...(base.page === undefined ? {} : { page: base.page }), candidates }); }
  catch (error) {
    if (!(error instanceof JevError) && !(error instanceof RoutingCatalogError)) throw error;
    console.warn(`[quick-chat] routing judgment failed for ${base.id}: ${error.message}`);
    judgment = null;
  }
  if (judgment === null) return needsChoice({ ...base, candidates, probabilities: {} }, { reason: "routing-unavailable" });
  const selection = selectRoutingDestination({ candidates: judgment.candidates, probabilities: judgment.probabilities,
    newChatRequested: thoughtAsksForNewChat(base.message) });
  const judged: RecordBase = { ...base, candidates: judgment.candidates, probabilities: judgment.probabilities,
    model: judgment.model, confidence: judgment.confidence, preferenceApplied: selection.preferenceApplied };
  if (routingDisposition({ selected: selection.selected, ranked: selection.ranked }) === "ask") return needsChoice(judged, { reason: "uncertain" });
  return startSending(ctx, { base: judged, selected: selection.selected });
}

export async function submitQuickChat(ctx: QuickChatContext, input: { id: string; message: string; origin: QuickChatOrigin; source?: QuickChatSource; sourceRef?: string; retainedRecording?: boolean; recordingInterrupted?: boolean; captureInputKind?: "words" | "transcript"; hqService?: string; page?: QuickChatPage }): Promise<QuickChatRecord> {
  return withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    let previous = await readQuickChatRecord(ctx.boxRoot, input.id);
    if (previous !== null) {
      if (previous.message !== input.message) throw new QuickChatTextConflictError();
      // Filing changes an undelivered source reference, never the submitted human words.
      if (previous.state !== "sent" && previous.state !== "discarded" && previous.sourceRef !== undefined
        && input.sourceRef !== undefined && previous.sourceRef !== input.sourceRef) {
        previous = { ...previous, sourceRef: input.sourceRef };
        await saveQuickChatRecord(ctx.boxRoot, previous);
      }
      return previous.state === "sending" ? attemptDelivery(ctx, previous) : previous;
    }
    const routed = await route(ctx, { id: input.id, message: input.message, origin: input.origin, ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.sourceRef === undefined ? {} : { sourceRef: input.sourceRef }), ...(input.retainedRecording === undefined ? {} : { retainedRecording: input.retainedRecording }), ...(input.recordingInterrupted === undefined ? {} : { recordingInterrupted: input.recordingInterrupted }), ...(input.captureInputKind === undefined ? {} : { captureInputKind: input.captureInputKind }),
      ...(input.hqService === undefined ? {} : { hqService: input.hqService }), ...(input.page === undefined ? {} : { page: input.page }), createdAt: getBoxTime(ctx.boxRoot).toISOString() });
    return routed.state === "needs-choice" ? save(ctx.boxRoot, routed) : routed;
  });
}

async function existing(ctx: QuickChatContext, id: string): Promise<QuickChatRecord> {
  const record = await readQuickChatRecord(ctx.boxRoot, id);
  if (record === null) throw new QuickChatNotFoundError();
  return record;
}

/** Fix the person's chosen destination and deliver. A finished record is returned unchanged. */
export async function chooseQuickChat(ctx: QuickChatContext, input: { id: string; candidateId: string }): Promise<QuickChatRecord> {
  return withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const record = await existing(ctx, input.id);
    switch (record.state) {
      case "needs-choice": {
        const selected = record.choices.includes(input.candidateId) ? record.candidates.find(candidate => candidate.id === input.candidateId) : undefined;
        if (selected === undefined) throw new QuickChatInvalidChoiceError();
        return startSending(ctx, { base: { ...baseOf(record), preferenceApplied: false }, selected });
      }
      case "sending":
        if (record.selected.id !== input.candidateId) throw new QuickChatDestinationFixedError(record.destination.label);
        return attemptDelivery(ctx, record);
      case "sent":
      case "discarded":
        return record;
    }
  });
}

/** Deliver a stored message again, as a repeat `submit` with its own text does. Other states are returned unchanged. */
export async function retryQuickChat(ctx: QuickChatContext, input: { id: string }): Promise<QuickChatRecord> {
  return withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const record = await existing(ctx, input.id);
    return record.state === "sending" ? attemptDelivery(ctx, record) : record;
  });
}

/** End a stored message the person no longer wants. A sent message cannot be discarded and is returned unchanged. */
export async function discardQuickChat(ctx: Pick<QuickChatContext, "boxRoot">, input: { id: string }): Promise<QuickChatRecord> {
  return withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    const record = await existing({ ...ctx, jev: undefined, chat: undefined }, input.id);
    if (record.state !== "needs-choice" && record.state !== "sending") return record;
    return save(ctx.boxRoot, { ...baseOf(record), state: "discarded", discardedAt: getBoxTime(ctx.boxRoot).toISOString(),
      ...(record.state === "sending" ? { destination: record.destination } : {}) });
  });
}

/** Follow-up to a capture whose destination is fixed; preserve the original delivery and message-id window. */
export async function submitQuickChatFollowup(ctx: QuickChatContext, input: {
  id: string; message: string; source: QuickChatSource; sourceRef: string;
  parent: Extract<QuickChatRecord, { state: "sent" }>;
}): Promise<QuickChatRecord> {
  return withQuickChatLock({ boxRoot: ctx.boxRoot, id: input.id }, async () => {
    let previous = await readQuickChatRecord(ctx.boxRoot, input.id);
    if (previous !== null) {
      if (previous.message !== input.message) throw new QuickChatTextConflictError();
      // Filing changes an undelivered source reference, never the submitted human words.
      if (previous.state !== "sent" && previous.state !== "discarded" && previous.sourceRef !== undefined
        && previous.sourceRef !== input.sourceRef) {
        previous = { ...previous, sourceRef: input.sourceRef };
        await saveQuickChatRecord(ctx.boxRoot, previous);
      }
      return previous.state === "sending" ? attemptDelivery(ctx, previous) : previous;
    }
    const parent = input.parent;
    const now = getBoxTime(ctx.boxRoot).toISOString();
    const record: SendingQuickChatRecord = {
      id: input.id, message: input.message, origin: "external", source: input.source, sourceRef: input.sourceRef, captureInputKind: "words",
      createdAt: now, candidates: parent.candidates, probabilities: parent.probabilities,
      ...(parent.retainedRecording === true ? { retainedRecording: true } : {}), ...(parent.recordingInterrupted === true ? { recordingInterrupted: true } : {}),
      state: "sending", selected: parent.selected, delivery: parent.delivery,
      destination: parent.destination, deliveryStartedAt: now,
    };
    // The existing-session candidate prevents reserveNewChat from silently reserving a different session.
    if (parent.destination.sessionId !== undefined) record.selected = { ...parent.selected,
      target: { kind: "existing-session", sessionId: parent.destination.sessionId, contextDir: parent.delivery?.contextDir ?? "" } };
    return attemptDelivery(ctx, record);
  });
}


/** Persist the actual harness-assigned chat without changing or re-sending human input. */
async function bindQuickChatSession(boxRoot: string, input: { id: string; sessionId: string }): Promise<void> {
  await withQuickChatLock({ boxRoot, id: input.id }, async () => {
    const record = await readQuickChatRecord(boxRoot, input.id);
    if (record === null || (record.state !== "sent" && record.state !== "sending") || record.delivery === null) return;
    if (record.destination.sessionId !== undefined && record.destination.sessionId !== input.sessionId) throw new QuickChatDestinationFixedError(record.destination.label);
    const delivery = { ...record.delivery, session: input.sessionId, exactSession: true };
    const selected = { ...record.selected, target: { kind: "existing-session" as const, sessionId: input.sessionId, contextDir: delivery.contextDir } };
    await saveQuickChatRecord(boxRoot, { ...record, delivery, selected, destination: { ...record.destination, sessionId: input.sessionId } });
  });
}
