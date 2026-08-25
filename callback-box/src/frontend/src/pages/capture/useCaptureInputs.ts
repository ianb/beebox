/**
 * Hidden file-input wiring for the capture page: the gallery (image-only)
 * and disk-file pickers, plus the change handlers that fan selected files
 * into the upload pipeline.
 */

import { useRef, useCallback } from "react";
import { type UploadState } from "./capture-api";
import { toastError } from "../../components/ui/toast-store";

interface CaptureInputsOptions {
  sessionId: string | null;
  photoTotal: number;
  fileTotal: number;
  setPhotoStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  setFileStates: React.Dispatch<React.SetStateAction<UploadState[]>>;
  uploadPhoto: (params: { sessionId: string; index: number; blob: Blob; startedAt: string; source: string }) => void;
  uploadFile: (params: { sessionId: string; index: number; file: File }) => void;
}

interface CaptureInputs {
  galleryRef: React.RefObject<HTMLInputElement>;
  uploadRef: React.RefObject<HTMLInputElement>;
  pickFromGallery: () => void;
  pickFileToUpload: () => void;
  handleGallerySelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
  const { sessionId, photoTotal, fileTotal, setPhotoStates, setFileStates, uploadPhoto, uploadFile } = options;
  const galleryRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const pickFromGallery = useCallback(() => { if (galleryRef.current) galleryRef.current.click(); }, []);
  const pickFileToUpload = useCallback(() => { if (uploadRef.current) uploadRef.current.click(); }, []);

  const handleGallerySelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return; // a cancelled picker
      if (!sessionId) { noSession(); e.target.value = ""; return; }
      const files = Array.from(e.target.files);
      const baseIndex = photoTotal;
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setPhotoStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        const startedAt = new Date().toISOString();
        uploadPhoto({ sessionId, index: baseIndex + i, blob: file, startedAt, source: "gallery" });
      }
      e.target.value = "";
    },
    [sessionId, photoTotal, uploadPhoto, setPhotoStates]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return; // a cancelled picker
      if (!sessionId) { noSession(); e.target.value = ""; return; }
      const files = Array.from(e.target.files);
      const baseIndex = fileTotal;
      const placeholders: UploadState[] = Array.from({ length: files.length }, (): UploadState => "uploading");
      setFileStates((prev) => [...prev, ...placeholders]);
      for (const [i, file] of files.entries()) {
        uploadFile({ sessionId, index: baseIndex + i, file });
      }
      e.target.value = "";
    },
    [sessionId, fileTotal, uploadFile, setFileStates]
  );

  return { galleryRef, uploadRef, pickFromGallery, pickFileToUpload, handleGallerySelect, handleFileSelect };
}
