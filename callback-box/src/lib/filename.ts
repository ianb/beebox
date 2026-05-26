/**
 * Shared filename helpers used by both backend (connectors, CLI) and frontend
 * (capture upload). Pure string operations — no Node or DOM deps.
 */

export interface SanitizeOptions {
  maxLength?: number;
  fallback?: string;
}

/**
 * Sanitize an arbitrary string into a filename stem (no extension).
 * Keeps alphanumerics, underscores, and hyphens; collapses whitespace
 * runs into underscores; strips leading/trailing separators; caps length.
 * Returns the fallback when nothing survives.
 */
export function sanitizeFilenameStem(
  text: string,
  options?: SanitizeOptions,
): string {
  const maxLength = options && options.maxLength !== undefined ? options.maxLength : 50;
  const fallback = options && options.fallback !== undefined ? options.fallback : "untitled";
  return (
    text
      .replace(/[^\s\w-]/g, "")
      .replace(/\s+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "")
      .slice(0, maxLength)
      .replace(/[_-]+$/, "") || fallback
  );
}

/** Split a filename into `{ stem, ext }`, where `ext` includes the leading dot. */
export function splitExtension(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { stem: filename, ext: "" };
  return { stem: filename.slice(0, dot), ext: filename.slice(dot) };
}

/**
 * Sanitize a full filename (stem + extension) — preserves the extension
 * dot and applies {@link sanitizeFilenameStem} to the stem.
 */
export function sanitizeFilename(
  filename: string,
  options?: SanitizeOptions,
): string {
  const { stem, ext } = splitExtension(filename);
  const safeExt = ext.replace(/[^\w.-]+/g, "");
  return sanitizeFilenameStem(stem, options) + safeExt;
}

export interface SlugifyOptions {
  maxLength?: number;
}

/**
 * Turn an arbitrary string into a lowercase hyphenated slug suitable for
 * URLs or directory names. Strips punctuation, collapses whitespace and
 * hyphen runs, and trims leading/trailing hyphens. Returns an empty
 * string when nothing survives.
 */
export function slugify(text: string, options?: SlugifyOptions): string {
  const maxLength = options && options.maxLength !== undefined ? options.maxLength : 50;
  return text
    .toLowerCase()
    .replace(/[^\d\sa-z-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}
