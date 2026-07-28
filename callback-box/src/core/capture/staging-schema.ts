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

/** A disk-uploaded file. */
const StagingFileSchema = z.object({
  filename: z.string(), uploadedAt: z.string(), originalName: z.string(), mimeType: z.string(),
});
export type StagingFile = z.infer<typeof StagingFileSchema>;

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
  state: StagingSessionStateSchema,
  segments: z.array(StagingSegmentSchema), photos: z.array(StagingPhotoSchema), files: z.array(StagingFileSchema),
  totalBytes: z.number().optional(), partial: z.boolean().optional(),
});
export type StagingSession = z.infer<typeof StagingSessionSchema>;

export function stagingBaseDir(boxRoot: string): string {
  return path.join(boxTmpDir(boxRoot), "capture-staging");
}

export function stagingSessionDir(boxRoot: string, id: string): string {
  return path.join(stagingBaseDir(boxRoot), id);
}
