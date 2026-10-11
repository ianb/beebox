/**
 * Turn arbitrary text into a safe filename stem: filesystem-hostile characters
 * stripped, an empty result replaced by the fallback. Used by Drive, Clerk and
 * Share when a title or name becomes a file name.
 */

import sanitize from "sanitize-filename";
import { sanitizeFilenameStem } from "../shared/filename.js";

export function safeFilename(text: string, fallback?: string): string {
  fallback = fallback ?? "untitled";
  return sanitizeFilenameStem(sanitize(text), { fallback });
}
