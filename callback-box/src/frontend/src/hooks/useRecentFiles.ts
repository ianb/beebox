/**
 * Track recently-touched file paths in the current chat session.
 *
 * Client-side: walks the message list and extracts paths from `view:` links
 * in text content and common path-shaped keys in tool-use inputs. Returns
 * a deduped list, most-recent-first (by last appearance), with summaries
 * fetched lazily via files.summarize.
 */

import { useMemo } from "react";
import type { SessionEntry, SessionContentBlock } from "../api";
import { trpc } from "../lib/trpc";
import type { FileSummary } from "../../../core/file-summary";

const TOOL_PATH_KEYS = [
  "path",
  "file_path",
  "notebook_path",
  "target_file",
  "source_file",
];

const VIEW_LINK_RE = /\bview:([^\s"#')<>?]+)/g;

function extractFromText(text: string, out: string[]): void {
  let m: RegExpExecArray | null;
  VIEW_LINK_RE.lastIndex = 0;
  while ((m = VIEW_LINK_RE.exec(text)) !== null) {
    const raw = m[1];
    if (raw) out.push(raw);
  }
}

function extractFromToolInput(input: Record<string, unknown>, out: string[]): void {
  for (const key of TOOL_PATH_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0 && !v.startsWith("/")) {
      out.push(v);
    }
  }
}

function extractFromBlock(block: SessionContentBlock, out: string[]): void {
  if (block.type === "text" && typeof block.text === "string") {
    extractFromText(block.text, out);
  } else if (block.type === "tool_use" && block.input) {
    extractFromToolInput(block.input, out);
  }
}

/**
 * Pull paths from a list of session entries. Older entries come first in
 * the result (chronological); the caller dedupes last-occurrence.
 */
export function collectPaths(entries: SessionEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    for (const block of entry.content) extractFromBlock(block, out);
  }
  return out;
}

/**
 * Dedupe a chronological list, keeping the LAST occurrence of each path
 * and reversing so most-recent comes first.
 */
export function dedupeRecent(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i]!;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export interface RecentFile {
  path: string;
  summary: FileSummary<unknown> | null;
}

/**
 * Observable list of recent files with lazy summaries.
 * `paths` is derived synchronously; summaries fetch in a single batch
 * via react-query so caching and loading state are handled idiomatically.
 */
export function useRecentFiles(entries: SessionEntry[]): {
  paths: string[];
  files: RecentFile[];
  isLoading: boolean;
} {
  const paths = useMemo(() => dedupeRecent(collectPaths(entries)), [entries]);

  const query = trpc.files.summarize.useQuery(
    { paths },
    { enabled: paths.length > 0 },
  );

  const files = useMemo<RecentFile[]>(() => {
    const results = query.data;
    if (!results) return paths.map(p => ({ path: p, summary: null }));
    return paths.map((p, i) => ({ path: p, summary: results[i] ?? null }));
  }, [paths, query.data]);

  return { paths, files, isLoading: query.isLoading };
}
