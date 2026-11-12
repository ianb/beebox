/**
 * Hidden file-input wiring for the capture page: the gallery (image-only)
 * and disk-file pickers, plus the change handlers that fan selected files
 * into the upload pipeline.
 */

import { useCallback, type ReactNode } from "react";
import { type UploadState } from "../api";
import { toastError } from "../../../components/ui/toast-store";
import { useFilePicker } from "../../../components/ui/fields/field";

interface CaptureInputsOptions {
  sessionId: string | null;
  /** Claim `count` consecutive photo indices; returns the first. */
  reservePhotos: (count: number) => number;
  fileTotal: number;
  setPhotoStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  setFileStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  uploadPhoto: (params: { sessionId: string; index: number; blob: Blob; startedAt: string; source: string }) => void;
  uploadFile: (params: { sessionId: string; index: number; file: File }) => void;
}

interface CaptureInputs {
  pickFromGallery: () => void;
  pickFileToUpload: () => void;
  /** The hidden gallery (image-only) and disk-file inputs, rendered by the capture surface. */
  galleryInput: ReactNode;
  uploadInput: ReactNode;
}

/**
 * Picking a file with no capture session used to do nothing at all — no upload,
 * no message, no trace. The session is absent exactly when capture failed to
 * start, which is the moment the user is most likely to reach for this button,
 * so the one path they had left answered with silence (a journey walker on
 * 2026-08-24 concluded the upload had failed too, and only found out otherwise
 * by backing out of capture). A user-initiated action never silently no-ops —
 * code-style.md defensiveness rule 5.
 */
function noSession(): void {
  toastError("Capture has not started, so there is nowhere to put this yet");
}

export function useCaptureInputs(options: CaptureInputsOptions): CaptureInputs {
  const { sessionId, reservePhotos, fileTotal, setPhotoStates, setFileStates, uploadPhoto, uploadFile } = options;
  const handleGallerySelect = useCallback(
    (files: File[]) => {
      if (!sessionId) { noSession(); return; }
      const baseIndex = reservePhotos(files.length);
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setPhotoStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        const startedAt = new Date().toISOString();
        uploadPhoto({ sessionId, index: baseIndex + i, blob: file, startedAt, source: "gallery" });
      }
    },
    [sessionId, reservePhotos, uploadPhoto, setPhotoStates]
  );

  const handleFileSelect = useCallback(
    (files: File[]) => {
      if (!sessionId) { noSession(); return; }
      const baseIndex = fileTotal;
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setFileStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        uploadFile({ sessionId, index: baseIndex + i, file });
      }
    },
    [sessionId, fileTotal, uploadFile, setFileStates]
  );

  const gallery = useFilePicker({ accept: "image/*", multiple: true, onFiles: handleGallerySelect });
  const upload = useFilePicker({ multiple: true, onFiles: handleFileSelect });
  return { pickFromGallery: gallery.open, pickFileToUpload: upload.open, galleryInput: gallery.input, uploadInput: upload.input };
}
