/**
 * Types for agent-generated views.
 *
 * Views are .tsx files in views/ that agents write. They get compiled
 * server-side with esbuild and rendered in the browser.
 */

export interface ViewProps {
  cards: ViewCard[];
  /** Metadata for non-card files matched by the dependency globs. */
  files: ViewFile[];
  /**
   * Fetch a box file's text content; pass {start, end} byte offsets for a
   * slice, or a negative start for a tail (start: -65536 → last 64KB).
   */
  readFile: (path: string, opts?: { start?: number; end?: number }) => Promise<string>;
  /** URL for a box file — use for <img src>, <audio src>, download links. */
  fileUrl: (path: string) => string;
  navigate: (path: string) => void;
  boxSlug: string;
  /** Query parameters from the view URL (e.g., path, custom filters). */
  params: Record<string, string>;
}

export interface ViewCard {
  path: string;
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
  status?: string;
  /** Files in this card's attach scope (deep), box-relative, with size/mtime. */
  attachments?: ViewFile[];
}

/**
 * File metadata delivered to a view. Content is fetched on demand via
 * readFile()/fileUrl() — attachments can be huge or binary, so nothing is
 * eagerly inlined.
 */
export interface ViewFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface ViewCardChild {
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
}

export type ViewMode = "page" | "chat";

export interface ViewMeta {
  name: string;
  slug: string;
  description: string;
  dependencies: string[];
  modes: ViewMode[];
  lastModified: string;
}
