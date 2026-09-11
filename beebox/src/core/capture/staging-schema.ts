/**
 * Capture staging session schema + path helpers.
 *
 * Split out of `staging-store.ts` so the manifest-I/O module
 * (`staging-manifest-io.ts`) can depend on the schema without creating a
 * value-import cycle with the store (store depends on both; io depends only
 * on this file).
 */

import * as path from "node:path";
import { z } from "zod";
import { boxTmpDir } from "../../lib/box-tmp.js";
import { assertNever } from "../../lib/invariant.js";
import { HQ_TRANSCRIPTION_SERVICES } from "../../shared/transcription-services.js";
import { CaptureAudioFormatSchema } from "./audio-format.js";

/**
 * Preparation/lifecycle state. `failed:<step>` records which preparation step
 * failed (Track 3), kept loud and inspectable on disk.
 */
const StagingSessionStateSchema = z.union([
  z.literal("open"), z.literal("sealed"), z.literal("preparing"), z.literal("delivering"), z.literal("delivered"),
  z.templateLiteral(["failed:", z.string()]),
]);
export type StagingSessionState = z.infer<typeof StagingSessionStateSchema>;

/** One recording start. WebM chunks are ordered; M4A has exactly one file. */
const StagingSegmentSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  format: CaptureAudioFormatSchema.default("webm-opus"),
  chunks: z.array(z.string()),
});
export type StagingSegment = z.infer<typeof StagingSegmentSchema>;

/**
 * A captured photo. `source` (camera-user/-environment/gallery) is retained
 * beyond the plan's listed shape because finalize needs it to set the image
 * card's `source`.
 */
const StagingPhotoSchema = z.object({
  filename: z.string(), capturedAt: z.string(), source: z.string(),
  originalName: z.string().optional(), mimeType: z.string().optional(),
});
export type StagingPhoto = z.infer<typeof StagingPhotoSchema>;

/**
 * A disk-uploaded file. `itemId` links the file back to a predeclared bulk
 * registry item (`expectedItems`) — set on bulk-upload sessions so finalize can
 * tell a received item from one that never arrived. Absent on capture-mode file
 * uploads, which have no predeclared registry.
 *
 * `size`/`sha256` are server-computed while the body streams to disk (bulk
 * streaming uploads, `addFileStreamed`), so limit-enforcement and the batch
 * manifest never trust a client-claimed size. Absent on capture's buffered
 * photo/audio/file writes.
 */
const StagingFileSchema = z.object({
  filename: z.string(), uploadedAt: z.string(), originalName: z.string(), mimeType: z.string(),
  itemId: z.string().optional(),
  size: z.number().optional(), sha256: z.string().optional(),
});
export type StagingFile = z.infer<typeof StagingFileSchema>;

/**
 * Which pipeline owns a staging session. `capture` (default) is the recorded
 * photo/voice-memo batch that becomes a capture-session card; `bulk` is a bulk
 * file-upload batch (`docs/implemented-plans/bulk-file-upload.md`) that becomes an
 * `upload-batch` card; `voice` is a chat voice recording
 * (`docs/plans/resilient-voice-recording.md`) staged as raw PCM chunks and
 * transcribed by the HQ job. Old manifests predate the field and parse as
 * `capture`.
 */
const StagingSessionKindSchema = z.enum(["capture", "bulk", "voice"]);
export type StagingSessionKind = z.infer<typeof StagingSessionKindSchema>;

/**
 * A terminal or in-progress classification of one HQ attempt's failure.
 * `transient`/`permanent` come from `classifyHqError`; `exhausted` is the job's
 * own verdict once the 24 h retry bound (`HQ_RETRY_BOUND_MS`) elapses. Carried
 * on both the `retrying` and `failed` HQ states so a resumed job and the client
 * badge can show the same reason without re-deriving it.
 */
export const HqFailureSchema = z.object({
  kind: z.enum(["transient", "permanent", "exhausted"]),
  code: z.string(),
  message: z.string(),
  upstreamStatus: z.number().optional(),
  /** Truncated to ≤500 chars by the caller before it reaches here. */
  upstreamBody: z.string().optional(),
});
export type HqFailure = z.infer<typeof HqFailureSchema>;

/** The finished HQ transcript, once every piece has succeeded. */
export const VoiceHqResultSchema = z.object({
  text: z.string(),
  diarized: z.boolean(),
  service: z.string(),
  pieces: z.number(),
});
export type VoiceHqResult = z.infer<typeof VoiceHqResultSchema>;

/**
 * The HQ job's progress for one voice recording. `none` until a finalize
 * requests HQ; `ready`/`failed` are the two terminal outcomes a client or the
 * late-delivery path can act on.
 */
export const VoiceHqStateSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({ state: z.literal("queued") }),
  z.object({
    state: z.literal("transcribing"),
    piece: z.number(),
    pieces: z.number(),
    attempt: z.number(),
    pieceSeconds: z.number(),
  }),
  z.object({
    state: z.literal("retrying"),
    attempt: z.number(),
    nextAttemptAt: z.string(),
    failure: HqFailureSchema,
    pieceSeconds: z.number(),
  }),
  z.object({ state: z.literal("ready"), result: VoiceHqResultSchema }),
  /** Terminal: no further retry. */
  z.object({ state: z.literal("failed"), failure: HqFailureSchema }),
]);
export type VoiceHqState = z.infer<typeof VoiceHqStateSchema>;

/**
 * Who has claimed the recording's realtime-vs-HQ text, and how the correction
 * (if any) is progressing. `open` until the client's submit flow decides;
 * `claimed` means the client sent HQ text itself; `late` means the client sent
 * realtime text and the server will correct it once HQ is ready;
 * `delivering`/`delivered` track that correction's own at-most-once send.
 */
export const VoiceHandoffSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("open") }),
  z.object({ mode: z.literal("claimed"), emissionId: z.string() }),
  z.object({ mode: z.literal("late"), emissionId: z.string() }),
  z.object({ mode: z.literal("delivering"), emissionId: z.string() }),
  z.object({ mode: z.literal("delivered"), emissionId: z.string(), messageId: z.string() }),
]);
export type VoiceHandoff = z.infer<typeof VoiceHandoffSchema>;

/**
 * Written once by the finalize that requests HQ. Survives every `hq` state
 * transition (including a server restart's resume), so a resumed job still
 * knows its 24 h retry deadline (`requestedAt`) and where to deliver a late
 * correction (`sessionId`).
 */
const VoiceHqRequestSchema = z.object({
  requestedAt: z.string(),
  service: z.enum(HQ_TRANSCRIPTION_SERVICES),
  emissionId: z.string(),
  sessionId: z.string(),
});

/**
 * The `voice`-kind manifest object. Present if and only if `kind === "voice"`
 * (enforced by {@link StagingSessionSchema}'s refinement) — every other kind
 * never carries one, so a dispatch site can trust `session.voice` exists
 * exactly when `isVoiceSession(session)` is true.
 */
const StagingVoiceSchema = z.object({
  /** Chat session the recording belongs to. */
  targetSessionId: z.string(),
  /** ISO, client clock. */
  startedAt: z.string(),
  sealedAt: z.string().optional(),
  hqRequest: VoiceHqRequestSchema.optional(),
  hq: VoiceHqStateSchema,
  handoff: VoiceHandoffSchema,
  /**
   * Set (server clock) the moment the recording first reaches a
   * GC-eligible terminal condition — `handoff.mode` becoming `claimed` or
   * `delivered`, or `hq.state` becoming `failed`/staying `none` on a sealed
   * session whose handoff isn't `late`/`delivering`. The voice sweep deletes
   * the session {@link VOICE_STAGING_RETENTION_MS} after this timestamp.
   * Written once; a later transition that is still terminal does not move it.
   */
  terminalAt: z.string().optional(),
});
export type StagingVoice = z.infer<typeof StagingVoiceSchema>;

/**
 * A predeclared bulk-upload item: a stable client-generated `id` plus the
 * client-claimed `name`/`size`/`mimetype`. Registered up front (and appended
 * while the picker streams) so finalize can compute a truthful
 * received/missing/failed split even after a tab dies mid-batch — the registry
 * is the only record of what was *supposed* to arrive. Bulk sessions only.
 */
const StagingBulkItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mimetype: z.string().optional(),
});
export type StagingBulkItem = z.infer<typeof StagingBulkItemSchema>;

/**
 * An item the uploader reported as failed at finalize, persisted onto the bulk
 * session (before the seal) so a crash-and-resume rebuilds the batch card with
 * the same `failed` list rather than silently re-classifying those items as
 * merely missing. `id` links back to a registry item when the uploader knows it.
 */
const StagingBulkFailedItemSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  reason: z.string(),
});
export type StagingBulkFailedItem = z.infer<typeof StagingBulkFailedItemSchema>;

/**
 * `createdBy` is the identifier (email) of the authenticated user who started
 * the capture, or `null` when unauthenticated (auth-disabled dev). The resume
 * query filters on this so one box user can never resume/submit another's
 * in-flight capture (X4). `null` matches `null` — legacy sessions predating
 * this field read as `null` and stay resumable only by an unauthenticated
 * caller.
 *
 * `totalBytes` accumulates across every staged upload, tracked at add time so
 * the per-session cap (X3) is a cheap running compare rather than a disk walk.
 * Optional for legacy manifests written before the cap existed (read as 0).
 *
 * `partial` is set true only when the abandonment sweep (Track 5) seals a
 * session the user never finalized. It flows through to the capture card's
 * `partial: true` frontmatter and the `<capture partial="1">` wrapper — a
 * deliberate "Submit now" or normal "Done" finalize leaves this unset
 * (partial: false).
 */
const StagingSessionBaseSchema = z.object({
  id: z.string(), createdAt: z.string(), lastActivityAt: z.string(),
  targetSessionId: z.string().nullable(), createdBy: z.string().nullable().default(null),
  kind: StagingSessionKindSchema.default("capture"),
  state: StagingSessionStateSchema,
  segments: z.array(StagingSegmentSchema), photos: z.array(StagingPhotoSchema), files: z.array(StagingFileSchema),
  /** Predeclared bulk-upload item registry (bulk sessions only). */
  expectedItems: z.array(StagingBulkItemSchema).optional(),
  /**
   * Box-relative context dir of the target chat, captured at bulk-session
   * creation so preparation places `tmp-upload/<slug>/` under the same chat the
   * overlay launched from — durable across a restart (bulk sessions only).
   */
  contextDir: z.string().optional(),
  /** Uploader-reported failed items, recorded at finalize (bulk sessions only). */
  failedItems: z.array(StagingBulkFailedItemSchema).optional(),
  /**
   * The user's introduction for this batch — verbatim composer text at the
   * moment they submitted it — recorded at finalize (bulk sessions only). Rides
   * IN the seal alongside `failedItems` so a resume rebuilds the same batch with
   * the same introduction. Absent when the composer was empty; an
   * introduction-less batch is what makes the agent ask before filing
   * (`src/schemas/upload-batch.tsx` duty 1).
   */
  note: z.string().optional(),
  /**
   * Set once the sweep has surfaced this batch to the chat agent as
   * sealed-but-undelivered, so the hand-off fires exactly once rather than every
   * sweep cycle (bulk sessions only).
   */
  strandedNotifiedAt: z.string().optional(),
  totalBytes: z.number().optional(), partial: z.boolean().optional(),
  /** The voice-recording manifest object. Voice sessions only — see {@link StagingVoiceSchema}. */
  voice: StagingVoiceSchema.optional(),
});

/**
 * `voice` is present if and only if `kind === "voice"` — checked once here so
 * every reader can trust the invariant rather than re-verifying it. A manifest
 * that violates this (hand-edited, or a future bug) fails to parse rather than
 * silently exposing a `voice` object on a capture/bulk session or an
 * `undefined` one on a voice session.
 */
export const StagingSessionSchema = StagingSessionBaseSchema.superRefine((session, ctx) => {
  if (session.kind === "voice" && session.voice === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "voice session is missing its voice object", path: ["voice"] });
  }
  if (session.kind !== "voice" && session.voice !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${session.kind} session must not carry a voice object`, path: ["voice"] });
  }
});
export type StagingSession = z.infer<typeof StagingSessionBaseSchema>;

/**
 * True for a capture-pipeline session. Written as an exhaustive switch so
 * adding a `kind` fails to compile here — forcing every enumerator/resume path
 * (`sweep.ts`, `resume.ts`, `pending.ts`) to decide how the new pipeline is
 * filtered rather than silently inheriting a `kind !== "capture"` string check.
 */
export function isCaptureSession(session: StagingSession): boolean {
  switch (session.kind) {
    case "capture":
      return true;
    case "bulk":
      return false;
    case "voice":
      return false;
    default:
      return assertNever(session.kind);
  }
}

/** True for a bulk-upload-pipeline session (the complement of {@link isCaptureSession} and {@link isVoiceSession}). */
export function isBulkSession(session: StagingSession): boolean {
  switch (session.kind) {
    case "capture":
      return false;
    case "bulk":
      return true;
    case "voice":
      return false;
    default:
      return assertNever(session.kind);
  }
}

/**
 * True for a voice-recording-pipeline session (`docs/plans/resilient-voice-recording.md`).
 * Written as an exhaustive switch for the same reason as {@link isCaptureSession}
 * — a future fourth kind must fail to compile here until this decides how it
 * is filtered.
 */
export function isVoiceSession(session: StagingSession): boolean {
  switch (session.kind) {
    case "capture":
      return false;
    case "bulk":
      return false;
    case "voice":
      return true;
    default:
      return assertNever(session.kind);
  }
}

export function stagingBaseDir(boxRoot: string): string {
  return path.join(boxTmpDir(boxRoot), "capture-staging");
}

export function stagingSessionDir(boxRoot: string, id: string): string {
  return path.join(stagingBaseDir(boxRoot), id);
}
