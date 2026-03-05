/**
 * File renderer plugin system.
 *
 * Every file can have multiple applicable renderers, sorted by priority.
 * The highest-priority renderer is shown by default; the user can toggle between them.
 */

import type { ElementNode } from "../api";

/** Data for rendering a file */
export interface FileData {
  path: string;
  tagName?: string;
  attrs?: Record<string, string>;
  element?: ElementNode;
  xml?: string;
  version?: string;
  status?: string;
}

/** Props passed to every renderer component */
export interface RendererProps {
  data: FileData;
  onPatch?: (ops: PatchOp[]) => Promise<void>;
  onNavigate: (path: string) => void;
}

/** A patch operation for modifying a card */
export type PatchOp =
  | { op: "set-attr"; path?: string; attr: string; value: string }
  | { op: "remove-attr"; path?: string; attr: string }
  | { op: "set-text"; path: string; value: string }
  | { op: "append-child"; path?: string; xml: string }
  | { op: "remove-child"; path: string; index: number };

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
  tagName?: string;
  renderer: FileRenderer;
}

const renderers: RendererMatch[] = [];

/** Register a renderer for a specific card type */
export function registerCardRenderer(tagName: string, renderer: FileRenderer) {
  renderers.push({ tagName, renderer });
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
      if (r.tagName) return data.tagName === r.tagName;
      if (r.fileMatch) return r.fileMatch(filePath, data);
      return false;
    })
    .map(r => r.renderer)
    .toSorted((a, b) => b.priority - a.priority);
}
