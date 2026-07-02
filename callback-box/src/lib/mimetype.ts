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
