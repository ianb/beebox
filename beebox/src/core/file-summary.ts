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

import type { CardSymbolData } from "../shared/card-symbol.js";
import type { ThemeChoice } from "../shared/card-theme.js";

export interface FileSummary<T = unknown> {
  /** Box-relative path to the file */
  path: string;
  /** Card type (from the filename); undefined for non-card files */
  type?: string;
  /** Authored choice, normalized to plain when an explicit selection is invalid. */
  cardTheme?: ThemeChoice;
  /** Always-present human-readable title. Loader computes; fallback is filename */
  title: string;
  /** The card's agent-written contains: sentence, when present. */
  contains?: string;
  /** The card's mark, `src` resolved to a box-relative path. Most cards have none. */
  symbol?: CardSymbolData;
  /** Typed attrs — shape depends on the loader */
  attrs?: T;
}

/**
 * Input passed to a loader. The server populates `fields` for parsed cards
 * and `content` for text files; loaders that don't need either just return
 * a summary keyed on `path`.
 */
export interface LoaderInput {
  path: string;
  /** Populated for frontmatter cards: the parsed frontmatter fields. */
  fields?: Record<string, unknown>;
  /** Card type — from the card's `fields.type`. */
  type?: string;
  /** Plain text content for non-card files. */
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
