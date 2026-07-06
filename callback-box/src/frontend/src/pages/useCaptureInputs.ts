/**
 * Hidden file-input wiring for the capture page: the gallery (image-only)
 * and disk-file pickers, plus the change handlers that fan selected files
 * into the upload pipeline.
 */

import { useRef, useCallback } from "react";
import { type UploadState } from "./capture-api";

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

export function useCaptureInputs(options: CaptureInputsOptions): CaptureInputs {
  const { sessionId, photoTotal, fileTotal, setPhotoStates, setFileStates, uploadPhoto, uploadFile } = options;
  const galleryRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  const pickFromGallery = useCallback(() => { if (galleryRef.current) galleryRef.current.click(); }, []);
  const pickFileToUpload = useCallback(() => { if (uploadRef.current) uploadRef.current.click(); }, []);

  const handleGallerySelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!sessionId || !e.target.files) return;
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
      if (!sessionId || !e.target.files) return;
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
