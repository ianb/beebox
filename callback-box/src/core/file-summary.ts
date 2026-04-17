/**
 * FileSummary — slim, parsed representation of a file for list contexts.
 *
 * Used by the files.summarize endpoint to ship structured metadata without
 * full XML/content bodies. Peek/panel/page escalations fetch full data
 * separately via the existing card/file endpoints.
 *
 * The generic type parameter carries the per-type attrs shape, derived via
 * `z.infer` from the card schema. Default `unknown` forces the fallback
 * path not to reach into attrs.
 */

import type { ElementNode } from "cardworks";

export interface FileSummary<T = unknown> {
  /** Box-relative path to the file */
  path: string;
  /** Root element tag for cards; undefined for non-card files */
  tagName?: string;
  /** Always-present human-readable title. Loader computes; fallback is filename */
  title: string;
  /** Typed attrs — shape depends on the loader */
  attrs?: T;
}

/**
 * Input passed to a loader. The server populates `element` for parsed cards
 * and `content` for text files; loaders that don't need either just return
 * a summary keyed on `path`.
 */
export interface LoaderInput {
  path: string;
  element?: ElementNode;
  content?: string;
}

export type FileLoader<T> = (raw: LoaderInput) => FileSummary<T>;

/**
 * Strip extensions and replace separators to produce a readable title from a path.
 * "Meeting_Notes.memo.card" → "Meeting Notes"
 * "photo-001.jpg" → "photo 001"
 */
export function titleFromFilename(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  const base = slash === -1 ? filePath : filePath.slice(slash + 1);
  const dot = base.indexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  return stem.replaceAll("_", " ").replaceAll("-", " ");
}

/**
 * Truncate text to n characters, appending an ellipsis if trimmed.
 */
export function truncateTitle(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).trimEnd() + "…";
}
