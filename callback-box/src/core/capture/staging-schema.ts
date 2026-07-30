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
 * photo/voice batch that becomes a capture-session card; `bulk` is a bulk
 * file-upload batch (`docs/implemented-plans/bulk-file-upload.md`) that becomes an
 * `upload-batch` card. Old manifests predate the field and parse as `capture`.
 */
const StagingSessionKindSchema = z.enum(["capture", "bulk"]);
export type StagingSessionKind = z.infer<typeof StagingSessionKindSchema>;

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
export const StagingSessionSchema = z.object({
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
  totalBytes: z.number().optional(), partial: z.boolean().optional(),
});
export type StagingSession = z.infer<typeof StagingSessionSchema>;

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
    default:
      return assertNever(session.kind);
  }
}

/** True for a bulk-upload-pipeline session (the complement of {@link isCaptureSession}). */
export function isBulkSession(session: StagingSession): boolean {
  switch (session.kind) {
    case "capture":
      return false;
    case "bulk":
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
