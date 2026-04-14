/**
 * Shared header for viewers rendered inline in chat (mode="chat").
 *
 * Shows the file's short name, the full path (truncated with hover tooltip),
 * and an "open in browse view (new tab)" icon linking to /$boxSlug/browse/$path.
 */

import { useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";

function displayName(path: string): string {
  const base = path.split("/").pop();
  if (!base) return path;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}

export function ChatViewerHeader({ filePath }: { filePath: string }) {
  const { boxSlug } = useParams({ strict: false });
  const browseHref = href(`/${boxSlug}/browse/${filePath}`);
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{displayName(filePath)}</div>
        <div className="text-xs text-warm-500 truncate" title={filePath}>{filePath}</div>
      </div>
      <a
        href={browseHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 p-1 text-warm-500 hover:text-warm-700 rounded hover:bg-warm-200"
        title="Open in browse view (new tab)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
