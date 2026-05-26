/**
 * Frontend FileType registry — maps a file (by tagName or path pattern) to
 * its presentation bits: icon (required) and an optional ListComponent that
 * renders a custom middle-slot for the list/peek entry.
 *
 * Dispatch rule mirrors the server loader registry: tagName exact match wins,
 * then the first path-pattern match, then the generic fallback.
 */

import type { FileSummary } from "../../../core/file-summary";
import { GenericIcon, type FileIcon } from "./icons";

export interface ListProps<T = unknown> {
  data: FileSummary<T>;
  /**
   * True when the container is narrow (mobile or squeezed column). Custom
   * ListComponents can use this to drop secondary content. Prefer CSS
   * (container queries) where possible; this flag is an explicit fallback.
   */
  compact: boolean;
}

export interface FileTypeUI<T = unknown> {
  icon: FileIcon;
  ListComponent?: React.ComponentType<ListProps<T>>;
}

interface TagReg {
  kind: "tagName";
  tagName: string;
  ui: FileTypeUI<unknown>;
}

interface PathReg {
  kind: "match";
  match: (path: string) => boolean;
  ui: FileTypeUI<unknown>;
}

type Reg = TagReg | PathReg;

const registrations: Reg[] = [];

export function registerFileType<T>(
  key: { tagName: string } | { match: (path: string) => boolean },
  ui: FileTypeUI<T>,
): void {
  if ("tagName" in key) {
    const existing = registrations.find(r => r.kind === "tagName" && r.tagName === key.tagName);
    if (existing) {
      console.warn(`FileType collision for tagName "${key.tagName}": overriding`);
      registrations.splice(registrations.indexOf(existing), 1);
    }
    registrations.push({
      kind: "tagName",
      tagName: key.tagName,
      ui: ui as FileTypeUI<unknown>,
    });
  } else {
    registrations.push({
      kind: "match",
      match: key.match,
      ui: ui as FileTypeUI<unknown>,
    });
  }
}

/**
 * Fallback UI — generic icon, no custom ListComponent (the default title-only
 * rendering applies).
 */
export const fallbackFileTypeUI: FileTypeUI<unknown> = {
  icon: GenericIcon,
};

export function resolveFileTypeUI(summary: FileSummary<unknown>): FileTypeUI<unknown> {
  if (summary.tagName) {
    const tagMatch = registrations.find(
      r => r.kind === "tagName" && r.tagName === summary.tagName,
    );
    if (tagMatch) return tagMatch.ui;
  }
  const pathMatches = registrations.filter(
    r => r.kind === "match" && r.match(summary.path),
  );
  if (pathMatches.length > 1) {
    console.warn(
      `FileType path collision for "${summary.path}": ${pathMatches.length} matches; using first`,
    );
  }
  const pathMatch = pathMatches[0];
  if (pathMatch) return pathMatch.ui;
  return fallbackFileTypeUI;
}

/**
 * Reset the registry. Intended for tests.
 */
export function resetFileTypeRegistry(): void {
  registrations.length = 0;
}
