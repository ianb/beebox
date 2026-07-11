/**
 * Per-event zod schemas for the SQLite-backed event bus — the read-side
 * validation boundary and the SINGLE SOURCE OF TRUTH for {@link EventMap}.
 *
 * The bus persists rows and is cross-process: a row read back through
 * `JSON.parse` (or replayed to another process) was NOT produced through the
 * typed `emit`/`emitTransient` surface, so the read boundary needs its own
 * validation. These schemas are validated in `event-bus.ts`'s `parseRows`; a
 * row that fails becomes the logged, counted `unknown` sentinel rather than
 * corrupting the stream (mirroring `unknownChatMessage` in
 * `core/chat/session/messages.ts`).
 *
 * `EventMap` is DERIVED from `eventSchemas` via `z.infer` — the schema is
 * authoritative and the producer-side `emit<K>` types can't drift from what the
 * read boundary accepts. Each schema is written as the EXACT current emit-site
 * shape (the emit-site audit confirmed all 27 sites match): a schema stricter
 * than a real payload would reject a legitimate live row.
 *
 * Bump `EVENT_SCHEMA_GENERATION` in `event-bus.ts` whenever any shape here
 * changes — on bus open a generation mismatch truncates the persisted rows so
 * "everything persisted is valid against current schemas" stays an invariant.
 */

import { z } from "zod";

/**
 * A background-task lifecycle event — mirrors `TaskEvent`
 * (`core/chat/session/message-types.ts`) exactly. Carried by `chat-task`.
 */
const taskEventSchema = z.object({
  phase: z.enum(["started", "progress", "updated", "settled"]),
  taskId: z.string(),
  toolUseId: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  status: z
    .enum(["pending", "running", "completed", "failed", "stopped", "killed", "paused"])
    .optional(),
  outputFile: z.string().optional(),
  elapsedMs: z.number().optional(),
  lastToolName: z.string().optional(),
});

/**
 * One content block of a session history entry — mirrors `SessionContentBlock`
 * (`cli/lib/session-content.ts`). Part of the `chat-history` payload.
 */
const sessionContentBlockSchema = z.object({
  type: z.enum(["text", "tool_use", "tool_result", "thinking", "image"]),
  text: z.string().optional(),
  toolName: z.string().optional(),
  toolId: z.string().optional(),
  inputSummary: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  toolUseId: z.string().optional(),
  resultSummary: z.string().optional(),
  mediaType: z.string().optional(),
  dataBase64: z.string().optional(),
  imageUrl: z.string().optional(),
});

/**
 * One session history entry — mirrors `SessionEntry`
 * (`cli/lib/session-entry.ts`). The elements of the `chat-history.entries`
 * array.
 */
const sessionEntrySchema = z.object({
  uuid: z.string(),
  type: z.enum(["user", "assistant", "compaction", "interrupted"]),
  timestamp: z.string(),
  content: z.array(sessionContentBlockSchema),
  user: z.string().optional(),
  userEmail: z.string().optional(),
});

/**
 * The bus's event catalog: every event name mapped to its payload schema. The
 * single source of truth for {@link EventMap}. Adding an event means adding a
 * key here (and bumping `EVENT_SCHEMA_GENERATION`).
 */
export const eventSchemas = {
  /** A watched file changed on disk (chokidar event name in `event`). */
  "file-change": z.object({
    event: z.string(),
    path: z.string(),
    timestamp: z.string(),
  }),
  /** A browser tab was asked to re-upload its last audio blob. */
  "chat-last-audio-request": z.object({ requestId: z.string() }),
  /** A card was created (optionally with a captured audio attachment). */
  "card-created": z.object({
    path: z.string(),
    template: z.string(),
    timestamp: z.string(),
    audioPath: z.string().optional(),
  }),
  /** A `cb` command finished (success flag for consumers to react on). */
  "command-complete": z.object({
    command: z.string(),
    success: z.boolean(),
    timestamp: z.string(),
  }),
  /**
   * A question card was answered via web/cli/api. `answer`/`selectedId` ride
   * from an untyped HTTP body (raw route) or an optional-string tRPC input, so
   * they stay genuinely arbitrary in value. Both are `.optional()`: an answer
   * carries only ONE of them, and `JSON.stringify` drops the undefined key, so
   * a persisted row legitimately omits it. (Zod v4 treats a bare `z.unknown()`
   * object property as REQUIRED — without `.optional()` a one-sided answer row
   * would wrongly degrade to the `unknown` sentinel on replay.)
   */
  "question-answered": z.object({
    path: z.string(),
    answer: z.unknown().optional(),
    selectedId: z.unknown().optional(),
    timestamp: z.string(),
  }),
  /** Cards in the box changed (coarse refresh signal). */
  "cards-changed": z.object({ source: z.string() }),
  /** A user message was sent into a chat session. */
  "chat-user-message": z.object({
    sessionId: z.string().nullable(),
    message: z.string(),
    user: z.object({ email: z.string(), name: z.string() }).nullable(),
    timestamp: z.string(),
  }),
  /** A chat turn completed. */
  "chat-complete": z.object({
    sessionId: z.string().nullable(),
    timestamp: z.string(),
  }),
  /** A background-task lifecycle event on a chat session. */
  "chat-task": z.object({
    sessionId: z.string().nullable(),
    task: taskEventSchema,
  }),
  /** A chat session's feature flags changed. */
  "chat-features-changed": z.object({
    sessionId: z.string(),
    features: z.record(z.string(), z.string()),
  }),
  /** A scheduled chat timer fired (`alarm`/`announce` from `ChatSchedule`). */
  "schedule-fired": z.object({
    id: z.string(),
    label: z.string(),
    alarm: z.boolean(),
    announce: z.string().nullable(),
  }),
  /** A chat session's history was (re)computed for delivery. */
  "chat-history": z.object({
    sessionId: z.string().nullable(),
    entries: z.array(sessionEntrySchema),
  }),
  /** A chat session id was assigned by the SDK. */
  "chat-session-assigned": z.object({ sessionId: z.string() }),
  /**
   * A capture staging session moved through preparation/delivery (Track 3).
   * Drives the pending capture bubble in chat. `docPath` is the box-relative
   * capture card once written; `sessionId` is the delivery target once known.
   */
  "capture-status": z.object({
    stagingId: z.string(),
    sessionId: z.string().nullable(),
    status: z.enum(["preparing", "transcribing", "delivered", "failed"]),
    docPath: z.string().optional(),
  }),
} satisfies Record<string, z.ZodType>;

/** A known event name. */
export type BusEventName = keyof typeof eventSchemas;

/**
 * The events the bus carries, each mapped to its payload shape — DERIVED from
 * {@link eventSchemas} so the schema is the single source of truth. `emit`/
 * `emitTransient` type their payload against this; the read boundary validates
 * against the same schemas.
 */
export type EventMap = {
  [K in BusEventName]: z.infer<(typeof eventSchemas)[K]>;
};
