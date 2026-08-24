/**
 * Sidebar list for the browse page: directory entries, card rows, and
 * raw-file rows. Appearance-heavy (hover states, selected highlight, row
 * chrome) so it lives in components/ rather than in the page.
 */

import { cbSource } from "../../../lib/source-tag";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import type { RouterOutput } from "../../../lib/trpc";
import { getApiBase } from "../../../api";
import { attachDirFor } from "@shared/attach-path";

type BrowseData = RouterOutput["status"]["browse"];

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg", ".ico"]);

function imageDataAttrs(relativePath: string, name: string): Record<string, string> | null {
  const dot = relativePath.lastIndexOf(".");
  if (dot <= 0) return null;
  if (!IMAGE_EXTS.has(relativePath.slice(dot).toLowerCase())) return null;
  return {
    "data-image-src": `${getApiBase()}/files/${relativePath}`,
    "data-image-alt": name,
  };
}

interface BrowseSidebarListProps {
  data: BrowseData;
  dirPath: string;
  loading: boolean;
  /**
   * Opens a row — a directory, a card, or a raw file. Every row is a URL, so
   * opening one is a real navigation (and a back-button step), not a
   * selection the URL doesn't know about.
   */
  onNavigate: (path: string) => void;
  selectedFilePath: string | null;
  onFileContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
}

export function BrowseSidebarList({
  data,
  dirPath,
  loading,
  onNavigate,
  selectedFilePath,
  onFileContextMenu,
}: BrowseSidebarListProps) {
  if (loading) {
    return <div className="p-4 text-warm-600 text-sm">Loading...</div>;
  }

  return (
    <div>
      {data.dirs.map((dir) => (
        <button
          key={dir.name}
          {...cbSource("dir", dirPath ? `${dirPath}/${dir.name}` : dir.name)}
          onClick={() =>
            onNavigate(dirPath ? `${dirPath}/${dir.name}` : dir.name)
          }
          aria-label={dir.fileCount > 0 ? `${dir.name} directory, ${dir.fileCount} item${dir.fileCount === 1 ? "" : "s"}` : `${dir.name} directory`}
          className="w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors flex items-center gap-2 border-b border-warm-200"
        >
          <span className="text-primary flex-shrink-0" aria-hidden="true">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
          </span>
          <span className="text-warm-900 font-medium text-sm flex-1">{dir.name}/</span>
          {dir.fileCount > 0 ? (
            <span className="text-xs text-warm-400">{dir.fileCount}</span>
          ) : null}
        </button>
      ))}

      {data.cards.map((card) => {
        // A card with an `.attach/` scope behaves like a directory: the row
        // still opens the card in the detail panel, but a trailing chevron
        // navigates INTO the attach scope (presented as the card itself —
        // the breadcrumb relabels the `.attach` segment to the card name).
        const attachPath = card.hasAttachments ? attachDirFor(card.relativePath) : null;
        return (
          <div
            key={card.relativePath}
            className={`flex items-stretch border-b border-warm-200 ${
              selectedFilePath === card.relativePath ? "bg-info-50" : ""
            }`}
          >
            <button
              onClick={() => onNavigate(card.relativePath)}
              {...cbSource("card", card.relativePath)}
              {...(card.type === "image" ? {
                "data-image-src": `${getApiBase()}/image/${card.relativePath}`,
                "data-image-alt": card.name,
              } : {})}
              aria-label={card.name === card.type ? `${card.name} card${card.status ? `, ${card.status}` : ""}` : `${card.name}, ${card.type} card${card.status ? `, ${card.status}` : ""}`}
              className="min-w-0 flex-1 text-left px-4 py-2.5 hover:bg-warm-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-warm-900 text-sm truncate">
                    {card.name}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-xs text-warm-500">{card.type}</span>
                  {card.status ? <StatusBadge status={card.status} size="sm" /> : null}
                </div>
              </div>
            </button>
            {attachPath ? (
              <button
                onClick={() => onNavigate(attachPath)}
                aria-label={`Open ${card.name} attachments`}
                title="Open attachments"
                className="flex-shrink-0 flex items-center px-3 text-primary hover:bg-warm-50 transition-colors border-l border-warm-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ) : null}
          </div>
        );
      })}

      {data.files.map((file) => (
        <button
          key={file.relativePath}
          onClick={() => onNavigate(file.relativePath)}
          onContextMenu={(event) => onFileContextMenu(event, file.relativePath)}
          {...(imageDataAttrs(file.relativePath, file.name) ?? {})}
          className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
            selectedFilePath === file.relativePath ? "bg-info-50" : ""
          }`}
        >
          <div className="font-medium text-warm-900 text-sm truncate">
            {file.name}
          </div>
        </button>
      ))}

      {data.dirs.length === 0 && data.cards.length === 0 && data.files.length === 0 ? (
        <div className="p-4 text-warm-600 text-sm text-center">
          Empty directory
        </div>
      ) : null}
    </div>
  );
}
