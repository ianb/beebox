/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { Sidebar } from "./Sidebar";
import { FileView } from "./FileView";
import { trpc, type RouterOutput } from "../lib/trpc";

type BrowseCard = RouterOutput["status"]["browse"]["cards"][number];

interface BrowsePageProps {
  /** Current directory path from URL splat (e.g., "store/recipes") */
  currentPath?: string;
  /** Called when navigating to a directory */
  onNavigate: (path: string) => void;
}

export function BrowsePage({ currentPath = "", onNavigate }: BrowsePageProps) {
  const { boxSlug } = useParams({ strict: false });
  const { data, isLoading: loading } = trpc.status.browse.useQuery({ path: currentPath });
  const [selectedCard, setSelectedCard] = useState<BrowseCard | null>(null);

  // Build breadcrumb segments
  const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

  const hasDetail = Boolean(selectedCard);

  return (
    <div className="h-full flex">
      <Sidebar title="Browse" subtitle={currentPath || "/"} detailSelected={hasDetail}>
        <div className="flex flex-col">
          {/* Breadcrumbs */}
          <div className="px-3 py-2 border-b text-sm flex flex-wrap items-center gap-1">
            <button
              onClick={() => onNavigate("")}
              className="text-plum hover:text-plum-dark hover:underline"
            >
              /
            </button>
            {segments.map((seg, i) => {
              const segPath = segments.slice(0, i + 1).join("/");
              const isLast = i === segments.length - 1;
              return (
                <span key={segPath} className="flex items-center gap-1">
                  {i > 0 && <span className="text-warm-500">/</span>}
                  {isLast ? (
                    <span className="text-warm-700 font-medium">{seg}</span>
                  ) : (
                    <button
                      onClick={() => onNavigate(segPath)}
                      className="text-plum hover:text-plum-dark hover:underline"
                    >
                      {seg}
                    </button>
                  )}
                </span>
              );
            })}
          </div>

          {loading ? (
            <div className="p-4 text-warm-600 text-sm">Loading...</div>
          ) : data ? (
            <div>
              {/* Directories */}
              {data.dirs.map((dir) => (
                <button
                  key={dir}
                  onClick={() =>
                    onNavigate(currentPath ? `${currentPath}/${dir}` : dir)
                  }
                  className="w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors flex items-center gap-2 border-b border-warm-200"
                >
                  <span className="text-plum flex-shrink-0">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </span>
                  <span className="text-warm-900 font-medium text-sm">{dir}/</span>
                </button>
              ))}

              {/* Cards */}
              {data.cards.map((card) => (
                <button
                  key={card.relativePath}
                  onClick={() => setSelectedCard(card)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
                    selectedCard?.relativePath === card.relativePath
                      ? "bg-iris-50"
                      : ""
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
                      {card.status ? (
                        <span className={`status-badge status-${card.status}`}>
                          {card.status}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}

              {/* Empty state */}
              {data.dirs.length === 0 && data.cards.length === 0 && (
                <div className="p-4 text-warm-600 text-sm text-center">
                  Empty directory
                </div>
              )}
            </div>
          ) : null}
        </div>
      </Sidebar>

      {/* Detail panel */}
      <div className={`flex-1 overflow-auto bg-warm-50 ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedCard ? (
          <div className="max-w-4xl mx-auto py-4 sm:py-8">
            <div className="mb-4 px-4 flex items-center justify-between">
              <button
                onClick={() => setSelectedCard(null)}
                className="sm:hidden flex items-center gap-1 text-sm text-plum hover:text-plum-dark"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <Link
                to={href(`/${boxSlug}/card/${selectedCard.relativePath}`)}
                className="text-plum hover:text-plum-dark text-sm"
              >
                Open full view &rarr;
              </Link>
            </div>
            <div className="bg-white rounded-lg shadow">
              <FileView path={selectedCard.relativePath} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            Select a card to view details
          </div>
        )}
      </div>
    </div>
  );
}
