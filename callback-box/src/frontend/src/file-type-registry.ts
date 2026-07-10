/**
 * Shared type→UI dispatch store backing both file renderers (`src/renderers`)
 * and file-type list UI (`src/file-types`). Before this module existed, a
 * card type had to be registered with each system separately — easy to do
 * for one and forget the other, which degraded silently (generic fallback
 * renderer/icon) rather than erroring.
 *
 * `registerFileType` takes one selector (exact card `type`, or a `path`/
 * `data` predicate) plus up to two independent facets: `renderer` (shown by
 * `src/renderers`, which can have many matches per file, toggled by the
 * user) and `listUI` (shown by `src/file-types`, exactly one per file — a
 * second `type`-keyed `listUI` registration overrides the first, matching
 * the collision behavior the old `file-types/registry.tsx` enforced). Each
 * facet is looked up independently by `getRenderers`/`resolveFileTypeUI`, so
 * a type can register a renderer only, a listUI only, or both in one call —
 * exactly as before, just through one function instead of two.
 */

import type { FileSummary } from "../../core/file-summary";
import type { NavigateHint, ViewTarget } from "./lib/view-url";
import { GenericIcon, type FileIcon } from "./file-types/icons";

/** Data for rendering a file. */
export interface FileData {
  path: string;
  /** Set for YAML frontmatter + markdown cards; absent for non-card files. */
  kind?: "frontmatter";
  /** Card type (from the filename). */
  type?: string;
  /** Frontmatter fields for cards (body field excluded). */
  frontmatter?: Record<string, unknown>;
  /** Markdown body for cards. */
  body?: string;
  /** Raw text content for non-card files (markdown, plaintext, json, etc.) */
  content?: string;
}

/** Props passed to every renderer component. */
export interface RendererProps {
  data: FileData;
  /**
   * Called when the user clicks a link that should switch this surface to
   * view a different file. `target` carries the resolved path plus any
   * `?view=`/`?zoom` modifiers from `view:` URLs, so the handler can decide
   * whether to push a new URL, swap a sidebar pane, open a zoomed view, etc.
   */
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /**
   * Embed query params from a `view:` link (e.g. `?molecule=H2O2`). Threaded
   * on the chat-embed path; absent on other surfaces for now. Renderers that
   * don't take parameters ignore it.
   */
  params?: Record<string, string>;
  /** The surface this renderer is shown in, so it can adapt its own chrome. */
  mode?: "page" | "chat" | "companion" | "embed";
  /**
   * The caption from an `![caption](path)` embed. A "media" renderer (image,
   * figure) shows it beneath the content so an embedded card reads exactly like
   * a normal captioned image; other renderers ignore it. Absent outside embeds.
   */
  caption?: string;
}

/** A renderer that can display a file. */
export interface FileRenderer {
  /** Display name shown in the view toggle. */
  name: string;
  /** The React component. */
  Component: React.ComponentType<RendererProps>;
  /** Priority — higher = more specific = shown first. Built-ins: source=0, xml=10, tree=20 */
  priority: number;
}

/** Props passed to a file type's custom list-entry middle slot. */
export interface ListProps<T = unknown> {
  data: FileSummary<T>;
  /**
   * True when the container is narrow (mobile or squeezed column). Custom
   * ListComponents can use this to drop secondary content. Prefer CSS
   * (container queries) where possible; this flag is an explicit fallback.
   */
  compact: boolean;
}

/** A file type's presentation bits for list/peek entries. */
export interface FileTypeUI<T = unknown> {
  icon: FileIcon;
  ListComponent?: React.ComponentType<ListProps<T>>;
}

/** Selects which files a registration applies to: an exact card type, or a path/data predicate. */
export type FileTypeSelector =
  | { type: string }
  | { match: (path: string, data?: FileData) => boolean };

interface Entry {
  selector: FileTypeSelector;
  renderer?: FileRenderer;
  listUI?: FileTypeUI<unknown>;
}

const entries: Entry[] = [];

function selectorMatches(
  selector: FileTypeSelector,
  subject: { path: string; type: string | undefined; data?: FileData },
): boolean {
  if ("type" in selector) return subject.type === selector.type;
  return selector.match(subject.path, subject.data);
}

/**
 * Register a renderer and/or list UI for a card type or file predicate. At
 * least one facet should be supplied; supplying neither registers nothing.
 * A second `type`-keyed `listUI` registration for the same type overrides
 * the first (logged) — matching one-list-UI-per-type. Multiple `renderer`
 * registrations for the same selector all stay live (the user can toggle
 * between them); there is no renderer collision to detect.
 */
export function registerFileType<T = unknown>(
  selector: FileTypeSelector,
  facets: { renderer?: FileRenderer; listUI?: FileTypeUI<T> },
): void {
  if (facets.listUI !== undefined && "type" in selector) {
    const existingIndex = entries.findIndex(
      e => e.listUI !== undefined && "type" in e.selector && e.selector.type === selector.type,
    );
    if (existingIndex !== -1) {
      console.warn(`FileType collision for type "${selector.type}": overriding`);
      entries.splice(existingIndex, 1);
    }
  }
  entries.push({
    selector,
    renderer: facets.renderer,
    // eslint-disable-next-line no-restricted-syntax -- generic erasure: the registry stores heterogeneous FileTypeUI<T> in one array as FileTypeUI<unknown>; T is recovered by the selector match at read time.
    listUI: facets.listUI as FileTypeUI<unknown> | undefined,
  });
}

/** Get all applicable renderers for a file, sorted by priority (highest first). */
export function getRenderers(filePath: string, data: FileData): FileRenderer[] {
  return entries
    .filter((e): e is Entry & { renderer: FileRenderer } =>
      e.renderer !== undefined && selectorMatches(e.selector, { path: filePath, type: data.type, data }))
    .map(e => e.renderer)
    .toSorted((a, b) => b.priority - a.priority);
}

/**
 * Fallback UI — generic icon, no custom ListComponent (the default title-only
 * rendering applies).
 */
export const fallbackFileTypeUI: FileTypeUI<unknown> = {
  icon: GenericIcon,
};

export function resolveFileTypeUI(summary: FileSummary<unknown>): FileTypeUI<unknown> {
  const listEntries = entries.filter((e): e is Entry & { listUI: FileTypeUI<unknown> } => e.listUI !== undefined);
  if (summary.type) {
    const typeMatch = listEntries.find(e => "type" in e.selector && e.selector.type === summary.type);
    if (typeMatch) return typeMatch.listUI;
  }
  const pathMatches = listEntries.filter(e =>
    "match" in e.selector && selectorMatches(e.selector, { path: summary.path, type: undefined }));
  if (pathMatches.length > 1) {
    console.warn(
      `FileType path collision for "${summary.path}": ${pathMatches.length} matches; using first`,
    );
  }
  // pathMatches can be empty (no path selector matched); the frontend tsconfig
  // lacks noUncheckedIndexedAccess, so `pathMatches[0]` would type `pathMatch`
  // as always-defined. `.at()` is typed `T | undefined` regardless, keeping
  // this check honest.
  const pathMatch = pathMatches.at(0);
  if (pathMatch) return pathMatch.listUI;
  return fallbackFileTypeUI;
}

/**
 * Reset the registry. Intended for tests.
 */
export function resetFileTypeRegistry(): void {
  entries.length = 0;
}
