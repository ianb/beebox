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
import { parseAcks } from "../lib/structured-output-parsing";
import { boxRelativePath } from "../../../shared/box-path.js";
import { isExternalUrl } from "../lib/view-url";

// Tool-input keys we treat as "agent touched this file". Deliberately
// excludes generic `path` (used by Grep/Glob/LS for the search *scope*,
// which is typically a directory or ".").
const TOOL_PATH_KEYS = [
  "file_path",
  "notebook_path",
  "target_file",
  "source_file",
];

// Legacy `view:` refs in older chat history (pre-migration).
const VIEW_LINK_RE = /\bview:([^\s"#')<>?]+)/g;
// Markdown link/image targets: [x](target) or ![x](target). Post-migration,
// cards/files are referenced by plain box path, so harvest those box-path
// targets (external URLs and anchors are skipped).
const MD_TARGET_RE = /!?\[[^\]]*]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;

function extractFromText(text: string, out: string[]): void {
  let m: RegExpExecArray | null;
  VIEW_LINK_RE.lastIndex = 0;
  while ((m = VIEW_LINK_RE.exec(text)) !== null) {
    const raw = m[1];
    if (raw) {
      const [clean = ""] = raw.split(/[#?]/, 1);
      out.push(boxRelativePath(clean));
    }
  }
  MD_TARGET_RE.lastIndex = 0;
  while ((m = MD_TARGET_RE.exec(text)) !== null) {
    const target = m[1];
    if (!target || isExternalUrl(target) || target.startsWith("#")) continue;
    const [clean = ""] = target.split(/[#?]/, 1);
    out.push(boxRelativePath(clean));
  }
  // <ack ref="…"> tags also indicate the agent touched a file — surface
  // those in recent-files too. Reuses the same parser the badge UI uses.
  for (const ack of parseAcks(text)) {
    if (ack.ref) out.push(ack.ref);
  }
}

function extractFromToolInput(input: Record<string, unknown>, out: string[]): void {
  for (const key of TOOL_PATH_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.length > 0) {
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
    const p = paths[i];
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

// The dropdown is a quick-jump list, not an exhaustive index — keep only the
// most-recent files. Also bounds the summarize request so a long session can't
// fan out into hundreds of file reads on every load.
const MAX_RECENT_FILES = 20;

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
  // dedupeRecent returns most-recent-first, so slicing keeps the newest.
  const paths = useMemo(() => dedupeRecent(collectPaths(entries)).slice(0, MAX_RECENT_FILES), [entries]);

  const query = trpc.files.summarize.useQuery(
    { paths },
    { enabled: paths.length > 0 },
  );

  const files = useMemo<RecentFile[]>(() => {
    const results = query.data;
    if (!results) return paths.map(p => ({ path: p, summary: null }));
    const seen = new Set<string>();
    const out: RecentFile[] = [];
    for (const [i, p] of paths.entries()) {
      const summary = results[i];
      if (summary === null || summary === undefined) continue;
      if (seen.has(summary.path)) continue;
      seen.add(summary.path);
      out.push({ path: p, summary });
    }
    return out;
  }, [paths, query.data]);

  return { paths, files, isLoading: query.isLoading };
}
