/**
 * Types for agent-generated views.
 *
 * Views are .tsx files in views/ that agents write. They get compiled
 * server-side with esbuild and rendered in the browser.
 */

export interface ViewProps {
  cards: ViewCard[];
  /** Non-card text files matched by the dependency globs (attachments, .md, .jsonl, ...). */
  files: ViewFile[];
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
  /** Files in this card's attach scope, scope-relative (e.g. "sessions/history.jsonl"). */
  attachments?: string[];
}

/** A non-card file delivered to a view: box-relative path + text content. */
export interface ViewFile {
  path: string;
  content: string;
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
