/**
 * File viewer registry for the view URL system.
 *
 * Maps file paths to viewer components. Separate from the card renderer
 * registry (renderers/index.ts) — this one handles full view-level display
 * of files, not individual card rendering within a CardView.
 */

import type React from "react";

export interface FileViewerProps {
  filePath: string;
  params: Record<string, string>;
  mode: "page" | "chat" | "companion";
}

export interface FileViewerEntry {
  name: string;
  Component: React.ComponentType<FileViewerProps>;
  priority: number;
  match: (filePath: string) => boolean;
}

const viewers: FileViewerEntry[] = [];

/** Register a file viewer */
export function registerFileViewer(entry: FileViewerEntry): void {
  viewers.push(entry);
}

/**
 * Get the best viewer for a file path.
 * If explicitName is provided (?view=X), returns the viewer with that name.
 * Otherwise returns the highest-priority matching viewer.
 */
export function getFileViewer(filePath: string, explicitName?: string | null): FileViewerEntry | null {
  if (explicitName) {
    return viewers.find(v => v.name === explicitName) ?? null;
  }
  const matches = viewers
    .filter(v => v.match(filePath))
    .toSorted((a, b) => b.priority - a.priority);
  return matches[0] ?? null;
}
