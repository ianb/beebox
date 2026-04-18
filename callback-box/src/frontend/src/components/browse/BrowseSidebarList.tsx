/**
 * Sidebar list for the browse page: directory entries, card rows, and
 * raw-file rows. Appearance-heavy (hover states, selected highlight, row
 * chrome) so it lives in components/ rather than in the page.
 */

import { href } from "../../lib/routing";
import { cbSource } from "../../lib/source-tag";
import { StatusBadge } from "../ui/StatusBadge";
import type { RouterOutput } from "../../lib/trpc";

type BrowseData = RouterOutput["status"]["browse"];

interface BrowseSidebarListProps {
  boxSlug?: string;
  data: BrowseData;
  dirPath: string;
  loading: boolean;
  onNavigate: (path: string) => void;
  selectedFilePath: string | null;
  onSelectFile: (path: string) => void;
  onFileContextMenu: (event: React.MouseEvent<HTMLButtonElement>, path: string) => void;
}

export function BrowseSidebarList({
  boxSlug,
  data,
  dirPath,
  loading,
  onNavigate,
  selectedFilePath,
  onSelectFile,
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
          className="w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors flex items-center gap-2 border-b border-warm-200"
        >
          <span className="text-primary flex-shrink-0">
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

      {data.cards.map((card) => (
        <button
          key={card.relativePath}
          onClick={() => {
            onSelectFile(card.relativePath);
            window.history.replaceState(null, "", href(`/${boxSlug}/browse/${card.relativePath}`));
          }}
          {...cbSource("card", card.relativePath)}
          className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
            selectedFilePath === card.relativePath ? "bg-info-50" : ""
          }`}
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
      ))}

      {(data.files ?? []).map((file) => (
        <button
          key={file.relativePath}
          onClick={() => {
            onSelectFile(file.relativePath);
            window.history.replaceState(null, "", href(`/${boxSlug}/browse/${file.relativePath}`));
          }}
          onContextMenu={(event) => onFileContextMenu(event, file.relativePath)}
          className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
            selectedFilePath === file.relativePath ? "bg-info-50" : ""
          }`}
        >
          <div className="font-medium text-warm-900 text-sm truncate">
            {file.name}
          </div>
        </button>
      ))}

      {data.dirs.length === 0 && data.cards.length === 0 && (data.files ?? []).length === 0 ? (
        <div className="p-4 text-warm-600 text-sm text-center">
          Empty directory
        </div>
      ) : null}
    </div>
  );
}
