/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { Fragment, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { Sidebar } from "./Sidebar";
import { FileView } from "./FileView";
import { trpc } from "../lib/trpc";
import { cbSource } from "../lib/source-tag";


interface BrowsePageProps {
  /** Current directory path from URL splat (e.g., "store/recipes" or "store/recipes/Foo.recipe.card") */
  currentPath?: string;
  /** Called when navigating to a directory */
  onNavigate: (path: string) => void;
}

/** Detect whether a path refers to a file (has an extension on the last segment). */
function isFilePath(p: string): boolean {
  if (!p) return false;
  const base = p.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1;
}

export function BrowsePage({ currentPath = "", onNavigate }: BrowsePageProps) {
  const { boxSlug } = useParams({ strict: false });

  // If currentPath points to a file, split into directory + filename
  const pathIsFile = isFilePath(currentPath);
  const dirPath = pathIsFile ? currentPath.split("/").slice(0, -1).join("/") : currentPath;
  const initialFile = pathIsFile ? currentPath : null;

  const { data, isLoading: loading } = trpc.status.browse.useQuery({ path: dirPath });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialFile);

  // Derive selected card metadata (for non-card files we just render via FileView)
  const selectedCard = selectedFilePath && data
    ? data.cards.find((c) => c.relativePath === selectedFilePath) || null
    : null;

  // Build breadcrumb segments from the directory path
  const segments = dirPath ? dirPath.split("/").filter(Boolean) : [];

  const hasDetail = Boolean(selectedFilePath);

  return (
    <div className="h-full flex">
      <Sidebar title="Browse" subtitle={dirPath || "/"} detailSelected={hasDetail}>
        <div className="flex flex-col">
          {/* Breadcrumbs — no whitespace between elements so it copies as a clean path. */}
          <div className="px-3 py-2 border-b text-sm break-words">
            <button
              onClick={() => onNavigate("")}
              className="text-plum hover:text-plum-dark hover:underline px-0.5"
            >/</button>
            {segments.map((seg, i) => {
              const segPath = segments.slice(0, i + 1).join("/");
              const isLast = i === segments.length - 1;
              return (
                <Fragment key={segPath}>
                  <wbr />
                  {i > 0 ? <span className="text-warm-500 px-0.5">/</span> : null}
                  {isLast ? (
                    <span className="text-warm-700 font-medium px-0.5">{seg}</span>
                  ) : (
                    <button
                      onClick={() => onNavigate(segPath)}
                      className="text-plum hover:text-plum-dark hover:underline px-0.5"
                    >{seg}</button>
                  )}
                </Fragment>
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
                  key={dir.name}
                  {...cbSource("dir", dirPath ? `${dirPath}/${dir.name}` : dir.name)}
                  onClick={() =>
                    onNavigate(dirPath ? `${dirPath}/${dir.name}` : dir.name)
                  }
                  className="w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors flex items-center gap-2 border-b border-warm-200"
                >
                  <span className="text-plum flex-shrink-0">
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

              {/* Cards */}
              {data.cards.map((card) => (
                <button
                  key={card.relativePath}
                  onClick={() => {
                    setSelectedFilePath(card.relativePath);
                    window.history.replaceState(null, "", href(`/${boxSlug}/browse/${card.relativePath}`));
                  }}
                  {...cbSource("card", card.relativePath)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
                    selectedFilePath === card.relativePath
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

              {/* Non-card files */}
              {(data.files ?? []).map((file) => (
                <button
                  key={file.relativePath}
                  onClick={() => {
                    setSelectedFilePath(file.relativePath);
                    window.history.replaceState(null, "", href(`/${boxSlug}/browse/${file.relativePath}`));
                  }}
                  className={`w-full text-left px-4 py-2.5 hover:bg-warm-50 transition-colors border-b border-warm-200 ${
                    selectedFilePath === file.relativePath
                      ? "bg-iris-50"
                      : ""
                  }`}
                >
                  <div className="font-medium text-warm-900 text-sm truncate">
                    {file.name}
                  </div>
                </button>
              ))}

              {/* Empty state */}
              {data.dirs.length === 0 && data.cards.length === 0 && (data.files ?? []).length === 0 && (
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
        {selectedFilePath ? (
          <div className="max-w-4xl mx-auto py-4 sm:py-8">
            <div className="mb-4 px-4 flex items-center justify-between">
              <button
                onClick={() => setSelectedFilePath(null)}
                className="sm:hidden flex items-center gap-1 text-sm text-plum hover:text-plum-dark"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              {selectedCard ? (
                <Link
                  to={href(`/${boxSlug}/card/${selectedCard.relativePath}`)}
                  className="text-plum hover:text-plum-dark text-sm"
                >
                  Open full view &rarr;
                </Link>
              ) : null}
            </div>
            <div className="bg-white rounded-lg shadow">
              <FileView path={selectedFilePath} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            Select a file to view details
          </div>
        )}
      </div>
    </div>
  );
}
