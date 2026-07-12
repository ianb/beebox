/**
 * Upload orchestration for the capture page.
 *
 * Owns the per-kind upload state (photos / audio chunks / disk files),
 * the failed-payload registries used for retry, the pending-upload promise
 * list awaited at finalize time, and the derived progress counts.
 */

import { useState, useRef, useCallback } from "react";
import { sanitizeFilename } from "@shared/filename";
import { type UploadState } from "./capture-api";
import { useCaptureApi } from "./capture-api-context";

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

interface CaptureUploads {
  photoStates: UploadState[];
  fileStates: UploadState[];
  audioChunks: AudioChunkStatus[];
  setPhotoStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  setFileStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  uploadPhoto: (params: UploadPhotoParams) => void;
  uploadFile: (params: UploadFileParams) => void;
  handleChunk: (params: ChunkParams) => void;
  retryFailedUploads: (sessionId: string) => void;
  awaitPending: () => Promise<void>;
  clearPendingAndFailed: () => void;
  resetState: () => void;
  counts: UploadCounts;
}

interface UploadCounts {
  photosUploaded: number; photosUploading: number; photosFailed: number; photoTotal: number;
  audioUploaded: number; audioUploading: number; audioFailed: number; audioTotal: number;
  filesUploaded: number; filesUploading: number; filesFailed: number; fileTotal: number;
  uploadsInProgress: boolean;
}

export function useCaptureUploads(): CaptureUploads {
  const { uploadCaptureFile } = useCaptureApi();
  const [photoStates, setPhotoStates] = useState<UploadState[]>([]);
  const [fileStates, setFileStates] = useState<UploadState[]>([]);
  const [audioChunks, setAudioChunks] = useState<AudioChunkStatus[]>([]);

  const pendingUploads = useRef<Promise<void>[]>([]);
  const failedPhotoData = useRef<Map<number, { blob: Blob; startedAt: string; source: string }>>(new Map());
  const failedAudioData = useRef<Map<string, FailedAudioData>>(new Map());
  const failedFileData = useRef<Map<number, { file: File }>>(new Map());

  const uploadPhoto = useCallback(
    ({ sessionId: sid, index, blob, startedAt, source }: UploadPhotoParams) => {
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const filename = `photo-${String(index + 1).padStart(3, "0")}.${ext}`;
      setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploading"; return next; });
      const p = uploadCaptureFile({ sessionId: sid, kind: "photo", filename, blob, startedAt, source })
        .then(() => {
          failedPhotoData.current.delete(index);
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "uploaded"; return next; });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[capture] Photo upload failed (${filename}): ${msg}`);
          failedPhotoData.current.set(index, { blob, startedAt, source });
          setPhotoStates((prev) => { const next = [...prev]; next[index] = "failed"; return next; });
        });
      pendingUploads.current.push(p);
    },
    [uploadCaptureFile]
  );

  const handleChunk = useCallback(
    ({ sessionId, segmentId, segmentIndex, segmentStartedAt, blob, index, startedAt }: ChunkParams) => {
      const key = `${segmentIndex}-${index}`;
      const filename = `audio-${segmentIndex}-${String(index + 1).padStart(3, "0")}.webm`;
      setAudioChunks((prev) => {
        const existing = prev.find((c) => c.key === key);
        if (existing) return prev.map((c) => (c.key === key ? { ...c, state: "uploading" } : c));
        return [...prev, { key, state: "uploading" }];
      });
      const p = uploadCaptureFile({
        sessionId, kind: "audio", filename, blob, startedAt,
        source: "microphone", segmentId, segmentStartedAt,
      })
        .then(() => {
          failedAudioData.current.delete(key);
          setAudioChunks((prev) => prev.map((c) => (c.key === key ? { ...c, state: "uploaded" } : c)));
        })
        .catch((e: Error) => {
          console.error(`[capture] Audio upload failed (${filename}):`, e);
          failedAudioData.current.set(key, { segmentId, segmentIndex, segmentStartedAt, blob, index, startedAt });
          setAudioChunks((prev) => prev.map((c) => (c.key === key ? { ...c, state: "failed" } : c)));
        });
      pendingUploads.current.push(p);
    },
    [uploadCaptureFile]
  );

  const uploadFile = useCallback(
    ({ sessionId: sid, index, file }: UploadFileParams) => {
      const safeName = sanitizeFilename(file.name, { fallback: "upload" });
      const filename = `file-${String(index + 1).padStart(3, "0")}-${safeName}`;
      const startedAt = new Date().toISOString();
      setFileStates((prev) => { const next = [...prev]; next[index] = "uploading"; return next; });
      const p = uploadCaptureFile({
        sessionId: sid,
        kind: "file",
        filename,
        blob: file,
        startedAt,
        source: "disk",
        originalName: file.name,
        mimeType: file.type || undefined,
      })
        .then(() => {
          failedFileData.current.delete(index);
          setFileStates((prev) => { const next = [...prev]; next[index] = "uploaded"; return next; });
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[capture] File upload failed (${filename}): ${msg}`);
          failedFileData.current.set(index, { file });
          setFileStates((prev) => { const next = [...prev]; next[index] = "failed"; return next; });
        });
      pendingUploads.current.push(p);
    },
    [uploadCaptureFile]
  );

  const retryFailedUploads = useCallback((sessionId: string) => {
    const photoEntries = Array.from(failedPhotoData.current.entries());
    for (const [index, data] of photoEntries) {
      failedPhotoData.current.delete(index);
      uploadPhoto({ sessionId, index, blob: data.blob, startedAt: data.startedAt, source: data.source });
    }
    const audioEntries = Array.from(failedAudioData.current.entries());
    for (const [key, data] of audioEntries) {
      failedAudioData.current.delete(key);
      handleChunk({
        sessionId,
        segmentId: data.segmentId,
        segmentIndex: data.segmentIndex,
        segmentStartedAt: data.segmentStartedAt,
        blob: data.blob,
        index: data.index,
        startedAt: data.startedAt,
      });
    }
    const fileEntries = Array.from(failedFileData.current.entries());
    for (const [index, data] of fileEntries) {
      failedFileData.current.delete(index);
      uploadFile({ sessionId, index, file: data.file });
    }
  }, [uploadPhoto, handleChunk, uploadFile]);

  // Wait for all in-flight uploads (audio chunks + photos + files) to settle,
  // then drop the resolved promises so the list doesn't grow unbounded.
  const awaitPending = useCallback(async () => {
    await Promise.all(pendingUploads.current);
    pendingUploads.current = [];
  }, []);

  // Abandon any in-flight uploads and forget failed payloads (cancel flow,
  // and the post-finalize cleanup in the done flow).
  const clearPendingAndFailed = useCallback(() => {
    pendingUploads.current = [];
    failedPhotoData.current.clear();
    failedAudioData.current.clear();
    failedFileData.current.clear();
  }, []);

  // Clear the three per-kind state arrays.
  const resetState = useCallback(() => {
    setPhotoStates([]);
    setFileStates([]);
    setAudioChunks([]);
  }, []);

  const counts = deriveCounts({ photoStates, fileStates, audioChunks });

  return {
    photoStates, fileStates, audioChunks,
    setPhotoStates, setFileStates,
    uploadPhoto, uploadFile, handleChunk, retryFailedUploads,
    awaitPending, clearPendingAndFailed, resetState,
    counts,
  };
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
  };
}
