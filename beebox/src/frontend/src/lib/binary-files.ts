/**
 * Binary file detection by extension.
 *
 * Used by FileView (to skip fetching the body as text) and by the plaintext
 * renderer (to opt out). Files matching this list are handled by either a
 * specialized renderer (image, pdf, etc.) or the generic binary download
 * renderer in `renderers/binary.tsx`.
 */

const BINARY_EXTS = new Set<string>([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".ico",
  // Audio / video
  ".mp3", ".m4a", ".mp4", ".wav", ".webm", ".ogg", ".aac", ".flac", ".mov",
  // Documents
  ".pdf",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp", ".rtf", ".epub", ".mobi",
  // Archives
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".7z", ".rar",
  // Binaries / disk images
  ".exe", ".dmg", ".iso", ".bin", ".so", ".dylib",
]);

export function pathExt(path: string): string {
  const base = path.split("/").pop();
  if (!base) return "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTS.has(pathExt(path));
}
