/**
 * File renderer plugin system.
 *
 * Every file can have multiple applicable renderers, sorted by priority.
 * The highest-priority renderer is shown by default; the user can toggle between them.
 */

import type { NavigateHint, ViewTarget } from "../lib/view-url";

/** Data for rendering a file */
export interface FileData {
  path: string;
  /** Set for YAML frontmatter + markdown cards; absent for non-card files. */
  kind?: "frontmatter";
  /** Card type (from the filename). */
  type?: string;
  /** Raw card file text (frontmatter + markdown) — used by the Source renderer. */
  raw?: string;
  /** Frontmatter fields for cards (body field excluded). */
  frontmatter?: Record<string, unknown>;
  /** Markdown body for cards. */
  body?: string;
  /** Raw text content for non-card files (markdown, plaintext, json, etc.) */
  content?: string;
}

/** Props passed to every renderer component */
export interface RendererProps {
  data: FileData;
  /**
   * Called when the user clicks a link that should switch this surface to
   * view a different file. `target` carries the resolved path plus any
   * `?view=`/`?zoom` modifiers from `view:` URLs, so the handler can decide
   * whether to push a new URL, swap a sidebar pane, open a zoomed view, etc.
   */
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
}

/** A renderer that can display a file */
export interface FileRenderer {
  /** Display name shown in the view toggle */
  name: string;
  /** The React component */
  Component: React.ComponentType<RendererProps>;
  /** Priority — higher = more specific = shown first. Built-ins: source=0, xml=10, tree=20 */
  priority: number;
}

interface RendererMatch {
  fileMatch?: (path: string, data: FileData) => boolean;
  type?: string;
  renderer: FileRenderer;
}

const renderers: RendererMatch[] = [];

/** Register a renderer for a specific card type */
export function registerCardRenderer(type: string, renderer: FileRenderer) {
  renderers.push({ type, renderer });
}

/** Register a renderer for files matching a predicate */
export function registerFileRenderer(
  match: (path: string, data: FileData) => boolean,
  renderer: FileRenderer,
) {
  renderers.push({ fileMatch: match, renderer });
}

/** Get all applicable renderers for a file, sorted by priority (highest first) */
export function getRenderers(filePath: string, data: FileData): FileRenderer[] {
  return renderers
    .filter(r => {
      if (r.type) return data.type === r.type;
      if (r.fileMatch) return r.fileMatch(filePath, data);
      return false;
    })
    .map(r => r.renderer)
    .toSorted((a, b) => b.priority - a.priority);
}
