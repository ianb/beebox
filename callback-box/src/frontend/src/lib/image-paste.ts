/**
 * Utilities for accepting images pasted/dropped into the chat composer.
 *
 * Images get downscaled client-side before being encoded as base64 so we
 * don't ship multi-megabyte phone photos through JSON. Photos re-encode via
 * `encodeCanvasBlob` — WebP when the browser can, else JPEG — both far smaller
 * than the source (AVIF is excluded: the Anthropic API rejects it — see
 * `canvas-encode.ts`). PNG sources are kept as **lossless PNG**: the browser
 * canvas only produces *lossy* WebP (no lossless flag exists), so converting a
 * screenshot / line-art PNG here would silently degrade it.
 * PNG→WebP belongs to the lossless, high-effort server-side intake step, not
 * this lossy client path (see issues/2026-06-18-avif-webp-for-stored-images.md).
 *
 * This is the transient chat-attachment path (already downscaled); archival
 * fidelity is the server's job.
 */

import { encodeCanvasBlob } from "./canvas-encode";

/** Max longest-side dimension after downscaling. */
const MAX_DIMENSION = 1920;

/** Quality for re-encoded photos. */
const PHOTO_QUALITY = 0.85;

/**
 * Something went wrong while decoding/re-encoding a pasted or dropped image.
 * The detail names the specific failed step (decode, reader, encode, etc.).
 */
class ImageProcessingError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ImageProcessingError";
  }
}

// Fixed failure details, named so they're passed as identifiers — a bare string
// literal is disallowed as an Error constructor's first argument.
const IMG_ERR = {
  decode: "Failed to decode image",
  readerResult: "Unexpected reader result",
  fileReader: "FileReader failed",
  canvasContext: "Canvas 2D context unavailable",
  toBlob: "canvas.toBlob failed",
} as const;

/**
 * Decoded result ready to attach to a chat message.
 */
export interface ProcessedImage {
  mimeType: string;
  /** Raw base64 (no data: prefix). */
  dataBase64: string;
  /** Object URL for UI preview (caller should revoke when done). */
  objectUrl: string;
  /** Pixel dimensions after downscaling. */
  width: number;
  height: number;
  /** Byte length of the encoded bytes (for UI display). */
  byteLength: number;
}

function readImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageProcessingError(IMG_ERR.decode));
    };
    img.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new ImageProcessingError(IMG_ERR.readerResult));
        return;
      }
      // result is a data URL like "data:image/png;base64,AAAA...". Strip prefix.
      const comma = result.indexOf(",");
      resolve(comma !== -1 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(reader.error ?? new ImageProcessingError(IMG_ERR.fileReader));
    reader.readAsDataURL(blob);
  });
}

/**
 * Downscale and re-encode an image blob for chat attachment.
 *
 * Skips resize when the source already fits within MAX_DIMENSION. Photos
 * re-encode to WebP when supported (else JPEG); PNG sources stay lossless
 * PNG, since the canvas can only produce lossy WebP.
 */
export async function processImageBlob(blob: Blob): Promise<ProcessedImage> {
  const img = await readImageElement(blob);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  const wasPng = blob.type === "image/png";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageProcessingError(IMG_ERR.canvasContext);
  ctx.drawImage(img, 0, 0, width, height);

  // PNG sources stay lossless PNG — canvas WebP is always lossy, so a pasted
  // screenshot/line-art would degrade. Photos take the WebP → JPEG cascade
  // (already lossy, so re-encoding is a clean win). The produced blob's type is
  // the format actually written, so label by it.
  const outBlob = wasPng
    ? await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"))
    : await encodeCanvasBlob(canvas, { quality: PHOTO_QUALITY, fallback: "image/jpeg" });
  if (!outBlob) throw new ImageProcessingError(IMG_ERR.toBlob);

  const mimeType = outBlob.type;
  const dataBase64 = await blobToBase64(outBlob);
  const objectUrl = URL.createObjectURL(outBlob);

  return {
    mimeType,
    dataBase64,
    objectUrl,
    width,
    height,
    byteLength: outBlob.size,
  };
}

/**
 * Decode a raw base64 payload (no `data:` prefix) back into a Blob, without a
 * network round-trip. Inverse of the {@link ProcessedImage.dataBase64} this
 * module produces — used to reconstruct the upload Blob after downscaling
 * (screenshot-request-handler) and to decode the clerk relay's captured PNG
 * (screenshot-relay). One decoder, both callers.
 */
export function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Extract image files from a ClipboardEvent / DragEvent data transfer.
 * Returns an empty array if none are present.
 */
export function extractImageFiles(
  dt: DataTransfer | null | undefined
): File[] {
  if (!dt) return [];
  const out: File[] = [];
  // Prefer files array (covers drag-drop cleanly)
  if (dt.files.length > 0) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith("image/")) out.push(f);
    }
    if (out.length > 0) return out;
  }
  // Fallback to items (covers clipboard paste on Chrome)
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}
