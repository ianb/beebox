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
  /**
   * Create or overwrite a box file (parent dirs created); returns the new
   * ViewFile. Does NOT commit. Conflict-safe saves pass {expect}: the
   * ViewFile you read (write fails 412 → ViewFileConflictError carrying
   * the current state if someone else changed it) or "absent"
   * (create-only — fails if the file appeared).
   */
  writeFile: (
    path: string,
    opts: { content: string; expect?: ViewFile | "absent" }
  ) => Promise<ViewFile>;
  /** Append to a box file (created when missing); same {expect} semantics. */
  appendFile: (
    path: string,
    opts: { content: string; expect?: ViewFile | "absent" }
  ) => Promise<ViewFile>;
  /**
   * Commit a file and its attachments (a card commits with its attach
   * scope; an attach-scope file commits with its owning card + scope) —
   * nothing else. Call at meaningful boundaries, not per keystroke;
   * box housekeeping sweeps anything left uncommitted.
   */
  commitFile: (path: string, message: string) => Promise<{ committed: boolean; hash?: string }>;
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
  /** Version token (mtime+size). Pass back via writeFile {expect} for conflict-safe saves. */
  etag: string;
  /**
   * Git working-tree state: "dirty" (tracked, uncommitted changes) or
   * "untracked" (git has never seen it). Absent = committed and clean.
   */
  gitStatus?: "dirty" | "untracked";
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
