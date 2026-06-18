/**
 * Utilities for accepting images pasted/dropped into the chat composer.
 *
 * Images get downscaled client-side before being encoded as base64 so we
 * don't ship multi-megabyte phone photos through JSON. We re-encode to WebP —
 * smaller than JPEG at matching quality, and (unlike JPEG) it keeps alpha, so
 * PNG sources convert cleanly instead of needing a passthrough. PNG-origin
 * images get a higher quality so lossy WebP doesn't soften sharp edges. If a
 * browser can't encode WebP, canvas.toBlob falls back to PNG and we label the
 * blob by its actual type.
 *
 * This is the transient chat-attachment path (already downscaled). Archival
 * *intake* compression — lossless, high-effort, for anything kept long-term —
 * is a separate server-side concern (see docs/ideas.md, "AVIF / WebP for
 * stored images"); the browser canvas can do neither.
 */

/** Max longest-side dimension after downscaling. */
const MAX_DIMENSION = 1920;

/** WebP quality for re-encoded photos (≈ JPEG 0.85 visually, smaller file). */
const WEBP_QUALITY_PHOTO = 0.85;
/** Higher WebP quality for PNG-origin images (screenshots/graphics, sharp edges). */
const WEBP_QUALITY_GRAPHIC = 0.92;

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
 * to WebP (PNG-origin images at a higher quality to protect sharp edges);
 * falls back to PNG if the browser can't encode WebP.
 */
export async function processImageBlob(blob: Blob): Promise<ProcessedImage> {
  const img = await readImageElement(blob);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  const scale = Math.min(1, MAX_DIMENSION / Math.max(srcW, srcH));
  const width = Math.round(srcW * scale);
  const height = Math.round(srcH * scale);

  // PNG-origin images (screenshots/graphics) get the higher quality; photos
  // the standard one. WebP keeps alpha, so the old PNG passthrough is gone.
  const quality = blob.type === "image/png" ? WEBP_QUALITY_GRAPHIC : WEBP_QUALITY_PHOTO;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageProcessingError(IMG_ERR.canvasContext);
  ctx.drawImage(img, 0, 0, width, height);

  const outBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageProcessingError(IMG_ERR.toBlob))),
      "image/webp",
      quality
    );
  });

  // canvas.toBlob falls back to image/png when WebP encoding isn't supported,
  // so trust the produced blob's type rather than the type we requested.
  const mimeType = outBlob.type || "image/webp";
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
