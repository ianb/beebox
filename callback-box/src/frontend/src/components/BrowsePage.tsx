/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { FileView } from "./FileView";
import { getBrowse, type BrowseResponse, type BrowseCardInfo } from "../api";

interface BrowsePageProps {
  /** Current directory path from URL splat (e.g., "store/recipes") */
  currentPath?: string;
  /** Called when navigating to a directory */
  onNavigate: (path: string) => void;
}

export function BrowsePage({ currentPath = "", onNavigate }: BrowsePageProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<BrowseCardInfo | null>(null);

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setSelectedCard(null);
    try {
      const result = await getBrowse(dirPath);
      setData(result);
    } catch (err) {
      console.error("Failed to browse:", err);
      setData({ path: dirPath, dirs: [], cards: [] });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDir(currentPath);
  }, [currentPath, fetchDir]);

  // Build breadcrumb segments
  const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  return (
    <div className="h-full flex">
      <Sidebar title="Browse" subtitle={currentPath || "/"}>
        <div className="flex flex-col">
          {/* Breadcrumbs */}
          <div className="px-3 py-2 border-b text-sm flex flex-wrap items-center gap-1">
            <button
              onClick={() => onNavigate("")}
              className="text-blue-600 hover:text-blue-800 hover:underline"
            >
              /
            </button>
            {segments.map((seg, i) => {
              const segPath = segments.slice(0, i + 1).join("/");
              const isLast = i === segments.length - 1;
              return (
                <span key={segPath} className="flex items-center gap-1">
                  {i > 0 && <span className="text-gray-400">/</span>}
                  {isLast ? (
                    <span className="text-gray-700 font-medium">{seg}</span>
                  ) : (
                    <button
                      onClick={() => onNavigate(segPath)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {seg}
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {loading ? (
            <div className="p-4 text-gray-500 text-sm">Loading...</div>
          ) : data ? (
            <div>
              {/* Directories */}
              {data.dirs.map((dir) => (
                <button
                  key={dir}
                  onClick={() =>
                    onNavigate(currentPath ? `${currentPath}/${dir}` : dir)
                  }
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-2 border-b border-gray-100"
                >
                  <span className="text-blue-500 flex-shrink-0">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </span>
                  <span className="text-gray-900 font-medium text-sm">{dir}/</span>
                </button>
              ))}

              {/* Cards */}
              {data.cards.map((card) => (
                <button
                  key={card.relativePath}
                  onClick={() => setSelectedCard(card)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 ${
                    selectedCard?.relativePath === card.relativePath
                      ? "bg-blue-50"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 text-sm truncate">
                        {card.name}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs text-gray-400">{card.type}</span>
                      {card.status && (
                        <span className={`status-badge status-${card.status}`}>
                          {card.status}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}

              {/* Empty state */}
              {data.dirs.length === 0 && data.cards.length === 0 && (
                <div className="p-4 text-gray-500 text-sm text-center">
                  Empty directory
                </div>
              )}
            </div>
          ) : null}
        </div>
      </Sidebar>

      {/* Detail panel */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {selectedCard ? (
          <div className="max-w-4xl mx-auto py-8">
            <div className="mb-4 px-4">
              <Link
                to={`/card/${selectedCard.relativePath}`}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                Open full view &rarr;
              </Link>
            </div>
            <div className="bg-white rounded-lg shadow">
              <FileView path={selectedCard.relativePath} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a card to view details
          </div>
        )}
      </div>
    </div>
  );
}
