/**
 * Upload bookkeeping for the capture page.
 *
 * Owns the per-kind upload state (photos / audio chunks / disk files), the
 * failed-payload registries used for retry, and the derived progress counts.
 * The transport itself — the serial queue, abort scope, and drain list — lives
 * in `useUploadRunner`, which this hook feeds.
 */

import { useState, useRef, useCallback } from "react";
import { sanitizeFilename } from "@shared/filename";
import { type UploadState } from "./capture-api";
import { useCaptureApi } from "./capture-api-context";
import { useUploadRunner, type ActiveUpload } from "./useUploadRunner";
import { UploadAbortedError } from "../../lib/binary-upload";

interface AudioChunkStatus {
  /** Composite `${segmentIndex}-${chunkIndex}` — unique across segments. */
  key: string;
  state: UploadState;
}

interface UploadPhotoParams {
  sessionId: string;
  index: number;
  blob: Blob;
  startedAt: string;
  source: string;
}

interface UploadFileParams {
  sessionId: string;
  index: number;
  file: File;
}

/** One chunk emitted by a per-segment `ChunkedRecorder`. */
interface ChunkParams {
  sessionId: string;
  segmentId: string;
  segmentIndex: number;
  segmentStartedAt: string;
  blob: Blob;
  index: number;
  startedAt: string;
}

interface FailedAudioData {
  segmentId: string;
  segmentIndex: number;
  segmentStartedAt: string;
  blob: Blob;
  index: number;
  startedAt: string;
}

/**
 * The three failed-payload registries, gathered so retry can sweep them. Typed
 * as bare `{ current }` boxes rather than `RefObject` — these refs are always
 * initialized, and `RefObject`'s nullable `current` would be a type-system lie
 * about state that cannot occur.
 */
interface FailedRegistries {
  photos: { current: Map<number, { blob: Blob; startedAt: string; source: string }> };
  audio: { current: Map<string, FailedAudioData> };
  files: { current: Map<number, { file: File }> };
}

interface CaptureUploads {
  photoStates: UploadState[];
  fileStates: UploadState[];
  audioChunks: AudioChunkStatus[];
  activeUpload: ActiveUpload | null;
  setPhotoStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  setFileStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  uploadPhoto: (params: UploadPhotoParams) => void;
  uploadFile: (params: UploadFileParams) => void;
  handleChunk: (params: ChunkParams) => void;
  retryFailedUploads: (sessionId: string) => void;
  /**
   * Monotonic count of upload failures, bumped SYNCHRONOUSLY inside the failure
   * handler. Done compares it across its wait; reading the rendered counts
   * instead would race — a failure's `setState` has not necessarily committed
   * (nor the effect that mirrors it into a ref) by the time `awaitPending`
   * resumes, so the seal could look clean. Monotonic rather than a total, so a
   * failure appearing while another is retried successfully can't net to zero.
   */
  readFailureSeq: () => number;
  /**
   * Refuse new media. Done closes this before draining, so no producer — a
   * late-resolving photo blob, a file picker that fires after the button was
   * disabled, a recorder tail — can enqueue into a session being sealed.
   */
  closeForSealing: () => void;
  /** Re-open after a Done that bounced back instead of sealing. */
  reopenAfterSealing: () => void;
  awaitPending: () => Promise<void>;
  /** Abort every queued and in-flight transfer (Done's "skip", and cancel). */
  abortPending: () => void;
  clearPendingAndFailed: () => void;
  resetState: () => void;
  counts: UploadCounts;
}

interface UploadCounts {
  photosUploaded: number; photosUploading: number; photosFailed: number; photoTotal: number;
  audioUploaded: number; audioUploading: number; audioFailed: number; audioTotal: number;
  filesUploaded: number; filesUploading: number; filesFailed: number; fileTotal: number;
  uploadsInProgress: boolean;
  /** Transfers accepted and not yet settled — what Done waits on. */
  pendingUploads: number;
}

export function useCaptureUploads(): CaptureUploads {
  const { uploadCaptureFile } = useCaptureApi();
  const [photoStates, setPhotoStates] = useState<UploadState[]>([]);
  const [fileStates, setFileStates] = useState<UploadState[]>([]);
  const [audioChunks, setAudioChunks] = useState<AudioChunkStatus[]>([]);
  const runner = useUploadRunner();
  const { enqueue, rearm } = runner;

  // Payloads of failed uploads, kept so Retry can replay them without asking
  // the camera/picker for the bytes again. Separate refs (not one object) so
  // each keeps a stable identity across renders for the useCallback deps.
  const failedPhotos = useRef(new Map<number, { blob: Blob; startedAt: string; source: string }>());
  const failedAudio = useRef(new Map<string, FailedAudioData>());
  const failedFiles = useRef(new Map<number, { file: File }>());
  const failureSeq = useRef(0);
  const sealed = useRef(false);

  const readFailureSeq = useCallback(() => failureSeq.current, []);
  const closeForSealing = useCallback(() => { sealed.current = true; }, []);
  const reopenAfterSealing = useCallback(() => { sealed.current = false; }, []);
  const isSealed = useCallback(() => sealed.current, []);
  const noteFailure = useCallback((opts: { filename: string; error: unknown }) => {
    failureSeq.current += 1;
    logUploadFailure(opts);
  }, []);

  const uploadPhoto = useCallback(
    ({ sessionId: sid, index, blob, startedAt, source }: UploadPhotoParams) => {
      if (isSealed()) return;
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const filename = `photo-${String(index + 1).padStart(3, "0")}.${ext}`;
      setPhotoStates(markAt(index, "uploading"));
      enqueue({
        filename,
        priority: false,
        send: ({ signal, onProgress }) =>
          uploadCaptureFile({ sessionId: sid, kind: "photo", filename, blob, startedAt, source, signal, onProgress }),
        onSuccess: () => {
          failedPhotos.current.delete(index);
          setPhotoStates(markAt(index, "uploaded"));
        },
        onFailure: (e: unknown) => {
          noteFailure({ filename, error: e });
          failedPhotos.current.set(index, { blob, startedAt, source });
          setPhotoStates(markAt(index, "failed"));
        },
      });
    },
    [uploadCaptureFile, enqueue, isSealed, noteFailure]
  );

  const handleChunk = useCallback(
    ({ sessionId, segmentId, segmentIndex, segmentStartedAt, blob, index, startedAt }: ChunkParams) => {
      if (isSealed()) return;
      const key = `${segmentIndex}-${index}`;
      const filename = `audio-${segmentIndex}-${String(index + 1).padStart(3, "0")}.webm`;
      setAudioChunks(markChunk(key, "uploading"));
      enqueue({
        filename,
        // Audio is small and near-live: it jumps the queue ahead of photos.
        priority: true,
        send: ({ signal, onProgress }) =>
          uploadCaptureFile({
            sessionId, kind: "audio", filename, blob, startedAt,
            source: "microphone", segmentId, segmentStartedAt, signal, onProgress,
          }),
        onSuccess: () => {
          failedAudio.current.delete(key);
          setAudioChunks(markChunk(key, "uploaded"));
        },
        onFailure: (e: unknown) => {
          noteFailure({ filename, error: e });
          failedAudio.current.set(key, { segmentId, segmentIndex, segmentStartedAt, blob, index, startedAt });
          setAudioChunks(markChunk(key, "failed"));
        },
      });
    },
    [uploadCaptureFile, enqueue, isSealed, noteFailure]
  );

  const uploadFile = useCallback(
    ({ sessionId: sid, index, file }: UploadFileParams) => {
      if (isSealed()) return;
      const safeName = sanitizeFilename(file.name, { fallback: "upload" });
      const filename = `file-${String(index + 1).padStart(3, "0")}-${safeName}`;
      const startedAt = new Date().toISOString();
      setFileStates(markAt(index, "uploading"));
      enqueue({
        filename,
        priority: false,
        send: ({ signal, onProgress }) =>
          uploadCaptureFile({
            sessionId: sid, kind: "file", filename, blob: file, startedAt, source: "disk",
            originalName: file.name, mimeType: file.type || undefined, signal, onProgress,
          }),
        onSuccess: () => {
          failedFiles.current.delete(index);
          setFileStates(markAt(index, "uploaded"));
        },
        onFailure: (e: unknown) => {
          noteFailure({ filename, error: e });
          failedFiles.current.set(index, { file });
          setFileStates(markAt(index, "failed"));
        },
      });
    },
    [uploadCaptureFile, enqueue, isSealed, noteFailure]
  );

  const retryFailedUploads = useCallback((sessionId: string) => {
    if (isSealed()) return;
    // A retry after an abort needs a live abort scope — the spent one would
    // reject every new transfer the moment it started.
    rearm();
    replayFailed({
      sessionId,
      failed: { photos: failedPhotos, audio: failedAudio, files: failedFiles },
      uploadPhoto, handleChunk, uploadFile,
    });
  }, [rearm, isSealed, uploadPhoto, handleChunk, uploadFile]);

  const { clearPending } = runner;
  const clearPendingAndFailed = useCallback(() => {
    clearPending();
    failedPhotos.current.clear();
    failedAudio.current.clear();
    failedFiles.current.clear();
  }, [clearPending]);

  const { clearActive } = runner;
  const resetState = useCallback(() => {
    setPhotoStates([]);
    setFileStates([]);
    setAudioChunks([]);
    clearActive();
  }, [clearActive]);

  return {
    photoStates, fileStates, audioChunks,
    activeUpload: runner.activeUpload,
    setPhotoStates, setFileStates,
    uploadPhoto, uploadFile, handleChunk, retryFailedUploads,
    readFailureSeq, closeForSealing, reopenAfterSealing,
    awaitPending: runner.awaitPending,
    abortPending: runner.abortPending,
    clearPendingAndFailed, resetState,
    counts: deriveCounts({ photoStates, fileStates, audioChunks }),
  };
}

/** Set one index of an indexed upload-state array. */
function markAt(index: number, state: UploadState): (prev: UploadState[]) => UploadState[] {
  return (prev) => {
    const next = [...prev];
    next[index] = state;
    return next;
  };
}

/** Set one audio chunk's state, appending it on first sight. */
function markChunk(key: string, state: UploadState): (prev: AudioChunkStatus[]) => AudioChunkStatus[] {
  return (prev) => {
    if (!prev.some((c) => c.key === key)) return [...prev, { key, state }];
    return prev.map((c) => (c.key === key ? { ...c, state } : c));
  };
}

/** Re-enqueue every registered failure, clearing each entry as it is replayed. */
function replayFailed(opts: {
  sessionId: string;
  failed: FailedRegistries;
  uploadPhoto: (params: UploadPhotoParams) => void;
  handleChunk: (params: ChunkParams) => void;
  uploadFile: (params: UploadFileParams) => void;
}): void {
  const { sessionId, failed, uploadPhoto, handleChunk, uploadFile } = opts;
  for (const [index, data] of Array.from(failed.photos.current.entries())) {
    failed.photos.current.delete(index);
    uploadPhoto({ sessionId, index, blob: data.blob, startedAt: data.startedAt, source: data.source });
  }
  for (const [key, data] of Array.from(failed.audio.current.entries())) {
    failed.audio.current.delete(key);
    handleChunk({ sessionId, ...data });
  }
  for (const [index, data] of Array.from(failed.files.current.entries())) {
    failed.files.current.delete(index);
    uploadFile({ sessionId, index, file: data.file });
  }
}

/** An abort is a deliberate user action, not a fault — log it as such. */
function logUploadFailure(opts: { filename: string; error: unknown }): void {
  const { filename, error } = opts;
  if (error instanceof UploadAbortedError) {
    console.warn(`[capture] Upload of ${filename} abandoned before it finished`);
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`[capture] Upload failed (${filename}): ${msg}`);
}

function deriveCounts(
  { photoStates, fileStates, audioChunks }:
  { photoStates: UploadState[]; fileStates: UploadState[]; audioChunks: AudioChunkStatus[] }
): UploadCounts {
  const photosUploaded = photoStates.filter((s) => s === "uploaded").length;
  const photosUploading = photoStates.filter((s) => s === "uploading").length;
  const photosFailed = photoStates.filter((s) => s === "failed").length;
  const audioUploaded = audioChunks.filter((c) => c.state === "uploaded").length;
  const audioUploading = audioChunks.filter((c) => c.state === "uploading").length;
  const audioFailed = audioChunks.filter((c) => c.state === "failed").length;
  const filesUploaded = fileStates.filter((s) => s === "uploaded").length;
  const filesUploading = fileStates.filter((s) => s === "uploading").length;
  const filesFailed = fileStates.filter((s) => s === "failed").length;
  return {
    photosUploaded, photosUploading, photosFailed, photoTotal: photoStates.length,
    audioUploaded, audioUploading, audioFailed, audioTotal: audioChunks.length,
    filesUploaded, filesUploading, filesFailed, fileTotal: fileStates.length,
    uploadsInProgress: photosUploading > 0 || audioUploading > 0 || filesUploading > 0,
    // An upload is "pending" exactly while it sits in the uploading state: set
    // on enqueue, cleared only when it settles.
    pendingUploads: photosUploading + audioUploading + filesUploading,
  };
}
