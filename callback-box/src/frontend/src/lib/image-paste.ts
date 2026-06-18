/**
 * Utilities for accepting images pasted/dropped into the chat composer.
 *
 * Images get downscaled client-side before being encoded as base64 so we
 * don't ship multi-megabyte phone photos through JSON. We re-encode via
 * `encodeCanvasBlob` — AVIF when the browser can, else WebP, else JPEG/PNG —
 * all far smaller than the originals, and (unlike JPEG) AVIF/WebP keep alpha,
 * so PNG sources convert cleanly instead of needing a passthrough. PNG-origin
 * images get a higher quality so lossy encoding doesn't soften sharp edges.
 *
 * This is the transient chat-attachment path (already downscaled). Archival
 * *intake* compression — lossless, high-effort, for anything kept long-term —
 * is a separate server-side concern (see docs/ideas.md, "AVIF / WebP for
 * stored images"); the browser canvas can do neither.
 */

import { encodeCanvasBlob } from "./canvas-encode";

/** Max longest-side dimension after downscaling. */
const MAX_DIMENSION = 1920;

/** Quality for re-encoded photos. */
const PHOTO_QUALITY = 0.85;
/** Higher quality for PNG-origin images (screenshots/graphics, sharp edges). */
const GRAPHIC_QUALITY = 0.92;

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
 * Skips resize when the source already fits within MAX_DIMENSION. Re-encodes
 * to AVIF/WebP when supported (PNG-origin images at a higher quality to protect
 * sharp edges), falling back to JPEG/PNG otherwise.
 */
export async function processImageBlob(blob: Blob): Promise<ProcessedImage> {
  const img = await readImageElement(blob);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  // PNG-origin images (screenshots/graphics) get the higher quality and a PNG
  // fallback; photos the standard quality and a JPEG fallback. AVIF/WebP keep
  // alpha, so the old PNG passthrough is gone.
  const wasPng = blob.type === "image/png";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageProcessingError(IMG_ERR.canvasContext);
  ctx.drawImage(img, 0, 0, width, height);

  const outBlob = await encodeCanvasBlob(canvas, {
    quality: wasPng ? GRAPHIC_QUALITY : PHOTO_QUALITY,
    fallback: wasPng ? "image/png" : "image/jpeg",
  });
  if (!outBlob) throw new ImageProcessingError(IMG_ERR.toBlob);

  // encodeCanvasBlob falls through AVIF → WebP → fallback; the produced blob's
  // type is the format actually written, so label by it, never the request.
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
 * Extract image files from a ClipboardEvent / DragEvent data transfer.
 * Returns an empty array if none are present.
 */
export function extractImageFiles(
  dt: DataTransfer | null | undefined
): File[] {
  if (!dt) return [];
  const out: File[] = [];
  // Prefer files array (covers drag-drop cleanly)
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) {
      if (f.type.startsWith("image/")) out.push(f);
    }
    if (out.length > 0) return out;
  }
  // Fallback to items (covers clipboard paste on Chrome)
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}
