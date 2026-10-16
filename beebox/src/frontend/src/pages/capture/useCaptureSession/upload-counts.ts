/**
 * The capture overlay's upload counts, derived from the per-item states:
 * what the status bar, the failure banner and Done read. Split out of
 * `useCaptureUploads` to keep that hook within its line budget.
 */

import type { UploadState } from "../api";

/** One audio chunk's upload, keyed `${segmentIndex}-${chunkIndex}`. */
export interface AudioChunkStatus {
  /** Composite `${segmentIndex}-${chunkIndex}` — unique across segments. */
  key: string;
  state: UploadState;
}

export interface UploadCounts {
  photosUploaded: number; photosUploading: number; photosFailed: number; photosUnreadable: number; photoTotal: number;
  audioUploaded: number; audioUploading: number; audioFailed: number; audioTotal: number;
  filesUploaded: number; filesUploading: number; filesFailed: number; filesUnreadable: number; fileTotal: number;
  uploadsInProgress: boolean;
  /** Transfers accepted and not yet settled — what Done waits on. */
  pendingUploads: number;
}

export function deriveCounts(
  { photoStates, fileStates, audioChunks }:
  { photoStates: UploadState[]; fileStates: UploadState[]; audioChunks: AudioChunkStatus[] }
): UploadCounts {
  const photosUploaded = photoStates.filter((s) => s === "uploaded").length;
  const photosUploading = photoStates.filter((s) => s === "uploading").length;
  const photosFailed = photoStates.filter((s) => s === "failed").length;
  const photosUnreadable = photoStates.filter((s) => s === "unreadable").length;
  const audioUploaded = audioChunks.filter((c) => c.state === "uploaded").length;
  const audioUploading = audioChunks.filter((c) => c.state === "uploading").length;
  const audioFailed = audioChunks.filter((c) => c.state === "failed").length;
  const filesUploaded = fileStates.filter((s) => s === "uploaded").length;
  const filesUploading = fileStates.filter((s) => s === "uploading").length;
  const filesFailed = fileStates.filter((s) => s === "failed").length;
  const filesUnreadable = fileStates.filter((s) => s === "unreadable").length;
  return {
    photosUploaded, photosUploading, photosFailed, photosUnreadable, photoTotal: photoStates.length,
    audioUploaded, audioUploading, audioFailed, audioTotal: audioChunks.length,
    filesUploaded, filesUploading, filesFailed, filesUnreadable, fileTotal: fileStates.length,
    uploadsInProgress: photosUploading > 0 || audioUploading > 0 || filesUploading > 0,
    // An upload is "pending" exactly while it sits in the uploading state: set
    // on enqueue, cleared only when it settles.
    pendingUploads: photosUploading + audioUploading + filesUploading,
  };
}
