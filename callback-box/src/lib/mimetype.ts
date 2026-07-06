/**
 * MIME-type helpers shared across the CLI create command and the webapp
 * upload route. Previously each had its own drifted copy of the map (one knew
 * about `image/heic`/`video/*`, the other about `application/pdf`/`text/plain`);
 * this is the reconciled union so an attachment gets the same extension no
 * matter which entry point wrote it.
 */

const MIMETYPE_EXTENSIONS: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp3": ".mp3",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/m4a": ".m4a",
  "audio/mp4": ".m4a",
  "audio/flac": ".flac",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "application/json": ".json",
};

/** Convert a MIME type to a file extension, or `.bin` if unknown. */
export function mimetypeToExtension(mimetype: string): string {
  return MIMETYPE_EXTENSIONS[mimetype] ?? ".bin";
}

/**
 * Extension → MIME type, the reverse direction. The superset table absorbing
 * the hand-rolled per-site maps that had each drifted to a different subset
 * (raw file serving, git-blob serving, image resolver, image-describe, the
 * gen-image dev tool). Callers pass their own `fallback` for extensions this
 * table doesn't know — the fallbacks deliberately differ (e.g. `image/jpeg`
 * for the image-describe path, `image/png` for gen-image, `application/octet-stream`
 * for the raw-file routes), so it stays a required argument rather than a
 * baked-in default.
 *
 * `.frozen` is intentionally ABSENT: api-files.ts maps it to `text/html` for
 * its sandboxed frozen-page preview, but serving `.frozen` inline as HTML is
 * only safe under that route's frozen CSP — keeping it out of the shared table
 * prevents another route from serving it inline unsandboxed.
 */
const EXTENSION_MIMETYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".webm": "audio/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".md": "text/markdown",
  ".card": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".htm": "text/html",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
};

/**
 * Convert a file extension (with leading dot, any case) to a MIME type,
 * falling back to `fallback` when the extension is unknown.
 */
export function extensionToMimetype(ext: string, { fallback }: { fallback: string }): string {
  return EXTENSION_MIMETYPES[ext.toLowerCase()] ?? fallback;
}
