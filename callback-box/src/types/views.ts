/**
 * Types for agent-generated views.
 *
 * Views are .tsx files in views/ that agents write. They get compiled
 * server-side with esbuild and rendered in the browser.
 */

export interface ViewProps {
  cards: ViewCard[];
  navigate: (path: string) => void;
  boxSlug: string;
}

export interface ViewCard {
  path: string;
  tagName: string;
  attrs: Record<string, string>;
  text?: string;
  children?: ViewCardChild[];
  status?: string;
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
