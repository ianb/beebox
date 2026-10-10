/**
 * The quick chat record: one submitted thought, its routing evidence, and the
 * state of its delivery (docs/plans/box-screen.md, track 1).
 *
 * A record is `needs-choice` (stored, no destination), `sending` (destination
 * fixed, delivery not acknowledged), `sent`, or `discarded`. Records written
 * before states existed carry no `state`; {@link parseQuickChatRecord} reads a
 * record with a `receipt` as `sent` and one without as `sending`.
 *
 * Callers see a {@link QuickChatView}: no probabilities, no candidate
 * internals. The record keeps them for calibrating the post floor.
 */

import { z } from "zod";
import { isRecord } from "../../../shared/is-record.js";
import { AGENT_ENGINES } from "../../../shared/agent-models.js";
import { routingCandidateSchema, type RoutingCandidate } from "./policy.js";

const QUICK_CHAT_STATES = ["needs-choice", "sending", "sent", "discarded"] as const;
export const QUICK_CHAT_REASONS = ["uncertain", "routing-unavailable", "destination-gone"] as const;
export type QuickChatReason = (typeof QUICK_CHAT_REASONS)[number];
/** How the person entered the thought. External inputs are neither keyboard text nor a recording. */
export const QUICK_CHAT_ORIGINS = ["typed", "voice", "external"] as const;
export type QuickChatOrigin = (typeof QUICK_CHAT_ORIGINS)[number];
export const QUICK_CHAT_SOURCES = ["apple-app-intents"] as const;
/**
 * The engine that produced a dictated thought's HQ text on the phone
 * (docs/plans/ios-quick-chat-hq.md); the same name as the native emission's
 * `hqService`. A short token, since it is framed into a wrapper attribute.
 */
export const quickChatHqServiceSchema = z.string().regex(/^[\da-z-]{1,64}$/);
export type QuickChatSource = (typeof QUICK_CHAT_SOURCES)[number];

/** Duplicate protection lasts 7 days (send-dedup.ts); refuse a late delivery a day before that. */
const QUICK_CHAT_DELIVERY_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
const MAX_CHOICES = 4;

const deliverySchema = z.object({
  session: z.string(), exactSession: z.boolean(), contextDir: z.string(), engine: z.enum(AGENT_ENGINES),
});
export type QuickChatDelivery = z.infer<typeof deliverySchema>;
const destinationSchema = z.object({ label: z.string(), sessionId: z.string().optional() });

const baseShape = {
  id: z.string().uuid(), message: z.string(), createdAt: z.string(),
  /** Absent on records written before the origin was kept: those were typed. */
  origin: z.enum(QUICK_CHAT_ORIGINS).default("typed"),
  source: z.enum(QUICK_CHAT_SOURCES).optional(),
  /** Absent: a typed thought, or the phone's live transcript. */
  hqService: quickChatHqServiceSchema.optional(),
  candidates: z.array(routingCandidateSchema),
  /** Empty when routing was unavailable. Kept for calibration; never shown. */
  probabilities: z.record(z.string(), z.number()),
  model: z.string().optional(), confidence: z.number().optional(), preferenceApplied: z.boolean().optional(),
};
const recordSchema = z.discriminatedUnion("state", [
  z.object({ ...baseShape, state: z.literal("needs-choice"), reason: z.enum(QUICK_CHAT_REASONS),
    choices: z.array(z.string()).min(1).max(MAX_CHOICES) }),
  z.object({ ...baseShape, state: z.literal("sending"), selected: routingCandidateSchema,
    delivery: deliverySchema.nullable(), destination: destinationSchema,
    deliveryStartedAt: z.string(), lastError: z.string().optional() }),
  z.object({ ...baseShape, state: z.literal("sent"), selected: routingCandidateSchema,
    delivery: deliverySchema.nullable(), destination: destinationSchema,
    deliveryStartedAt: z.string().optional(), queued: z.boolean().optional(),
    /** Absent only on records written before states existed. */
    sentAt: z.string().optional() }),
  z.object({ ...baseShape, state: z.literal("discarded"), discardedAt: z.string(),
    destination: destinationSchema.optional() }),
]);
export type QuickChatRecord = z.infer<typeof recordSchema>;
export type SendingQuickChatRecord = Extract<QuickChatRecord, { state: "sending" }>;

const legacyReceiptSchema = z.object({ sessionId: z.string().optional(), turnId: z.string().optional(), queued: z.boolean().optional() });
/** The record the retired `quickChat.prepare` wrote; it has no state. */
const legacyQuickChatRecordSchema = z.object({
  id: z.string().uuid(), message: z.string(), createdAt: z.string(),
  sourceId: z.string().uuid().optional(),
  candidates: z.array(routingCandidateSchema), selected: routingCandidateSchema,
  probabilities: z.record(z.string(), z.number()), model: z.string(), confidence: z.number(),
  preferenceApplied: z.boolean(),
  delivery: deliverySchema.nullable(),
  receipt: legacyReceiptSchema.optional(),
});

/** The session a delivery names, when it names one before the engine runs. */
export function deliverySessionId(delivery: QuickChatDelivery | null): string | undefined {
  return delivery === null || delivery.session === "new" ? undefined : delivery.session;
}

/** Parse a record from disk, reading a record written before states existed by its receipt. */
export function parseQuickChatRecord(raw: unknown): QuickChatRecord {
  if (isRecord(raw) && "state" in raw) return recordSchema.parse(raw);
  const legacy = legacyQuickChatRecordSchema.parse(raw);
  const { id, message, createdAt, candidates, probabilities, model, confidence, preferenceApplied, selected, delivery, receipt } = legacy;
  const base = { id, message, createdAt, origin: "typed" as const, candidates, probabilities, model, confidence, preferenceApplied, selected, delivery };
  const sessionId = receipt?.sessionId ?? deliverySessionId(delivery);
  const destination = { label: selected.label, ...(sessionId === undefined ? {} : { sessionId }) };
  if (receipt !== undefined) {
    return { ...base, state: "sent", destination, ...(receipt.queued === true ? { queued: true } : {}) };
  }
  // The page may have sent it before stopping, so its delivery window starts at creation.
  return { ...base, state: "sending", destination, deliveryStartedAt: createdAt };
}

export const quickChatViewSchema = z.object({
  id: z.string().uuid(), message: z.string(), createdAt: z.string(), state: z.enum(QUICK_CHAT_STATES),
  destination: destinationSchema.optional(),
  queued: z.boolean().optional(),
  reason: z.enum(QUICK_CHAT_REASONS).optional(),
  lastError: z.string().optional(),
  /** A `sending` record past the delivery window: offer Open chat and Discard, never Retry. */
  expired: z.literal(true).optional(),
  choices: z.array(z.object({ candidateId: z.string(), label: z.string(), detail: z.string().optional() })).max(MAX_CHOICES).optional(),
});
export type QuickChatView = z.infer<typeof quickChatViewSchema>;

/** True when a delivery attempt now would outlive the message-id claim. */
export function deliveryExpired(record: SendingQuickChatRecord, now: number): boolean {
  return now - Date.parse(record.deliveryStartedAt) > QUICK_CHAT_DELIVERY_WINDOW_MS;
}

function expiredDeliveryMessage(label: string): string {
  return `This may already be in ${label}. Open the chat to check.`;
}

function choiceView(candidate: RoutingCandidate): NonNullable<QuickChatView["choices"]>[number] {
  const detail = candidate.target.kind === "existing-session" ? candidate.landmark?.label : undefined;
  return { candidateId: candidate.id, label: candidate.label, ...(detail === undefined ? {} : { detail }) };
}

/** What the box screen shows for one record at `now`. */
export function quickChatView(record: QuickChatRecord, now: number): QuickChatView {
  const base = { id: record.id, message: record.message, createdAt: record.createdAt, state: record.state };
  switch (record.state) {
    case "needs-choice": {
      const byId = new Map(record.candidates.map((candidate) => [candidate.id, candidate]));
      const choices = record.choices.flatMap((id) => {
        const candidate = byId.get(id);
        return candidate === undefined ? [] : [choiceView(candidate)];
      });
      return { ...base, reason: record.reason, choices };
    }
    case "sending":
      if (deliveryExpired(record, now)) {
        return { ...base, destination: record.destination, lastError: expiredDeliveryMessage(record.destination.label), expired: true };
      }
      return { ...base, destination: record.destination, ...(record.lastError === undefined ? {} : { lastError: record.lastError }) };
    case "sent":
      return { ...base, destination: record.destination, ...(record.queued === true ? { queued: true } : {}) };
    case "discarded":
      return base;
  }
}

/** The candidate for a new chat at the box root; every catalog ends with one. */
function isGeneralCandidate(candidate: RoutingCandidate): boolean {
  return candidate.target.kind === "new-session" && candidate.target.contextDir === "";
}

/**
 * The destinations offered when the box cannot place a thought: the three most
 * likely (or, without a judgment, the three most recent chats), plus a new
 * general chat when it is not among them. `exclude` drops a destination that
 * has gone.
 */
export function quickChatChoiceIds(args: {
  candidates: RoutingCandidate[];
  probabilities: Record<string, number>;
  exclude?: string;
}): string[] {
  const judged = Object.keys(args.probabilities).length > 0;
  const pool = args.candidates.filter((candidate) => candidate.id !== args.exclude);
  const ordered = judged
    ? pool.toSorted((a, b) => (args.probabilities[b.id] ?? 0) - (args.probabilities[a.id] ?? 0))
    : pool.filter((candidate) => candidate.target.kind === "existing-session");
  const top = ordered.slice(0, MAX_CHOICES - 1);
  const general = pool.find(isGeneralCandidate);
  return [...top, ...(general !== undefined && !top.includes(general) ? [general] : [])].map((candidate) => candidate.id);
}
