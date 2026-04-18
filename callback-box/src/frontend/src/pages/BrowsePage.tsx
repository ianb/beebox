/* eslint-disable personal-vibe-check/restrict-component-classes */
/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 *
 * TODO: refactor to UI primitives to remove the eslint-disable above.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { getApiBase } from "../api";
import { href } from "../lib/routing";
import { Sidebar } from "../components/Sidebar";
import { FileView } from "../components/FileView";
import { trpc, type RouterOutput } from "../lib/trpc";
import { cbSource } from "../lib/source-tag";
import { StatusBadge } from "../components/ui/StatusBadge";


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

function isRawFilePath(p: string): boolean {
  return isFilePath(p) && !p.endsWith(".card");
}

function displayName(path: string): string {
  return path.split("/").pop() ?? path;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

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

function BrowseSidebarList({
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

interface BrowseDetailPanelProps {
  boxSlug?: string;
  deleteError: string | null;
  deletingPath: string | null;
  onBack: () => void;
  onDelete: (path: string) => void | Promise<void>;
  selectedCard: { relativePath: string } | null;
  selectedFilePath: string;
  selectedRawFile: string | null;
}

function BrowseDetailPanel({
  boxSlug,
  deleteError,
  deletingPath,
  onBack,
  onDelete,
  selectedCard,
  selectedFilePath,
  selectedRawFile,
}: BrowseDetailPanelProps) {
  return (
    <div className="max-w-4xl mx-auto py-4 sm:py-8">
      <div className="mb-4 px-4 flex items-center">
        <button
          onClick={onBack}
          className="sm:hidden flex items-center gap-1 text-sm text-primary hover:text-primary-dark"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      </div>
      {deleteError ? (
        <div className="mb-4 mx-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-dark">
          {deleteError}
        </div>
      ) : null}
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-start justify-between gap-4 border-b border-warm-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-warm-900" title={selectedFilePath}>
              {displayName(selectedFilePath)}
            </h2>
            <div className="truncate text-sm text-warm-500" title={selectedFilePath}>
              {selectedFilePath}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedCard ? (
              <Link
                to={href(`/${boxSlug}/card/${selectedCard.relativePath}`)}
                className="text-primary hover:text-primary-dark text-sm"
              >
                Open full view &rarr;
              </Link>
            ) : null}
            {selectedRawFile ? (
              <button
                type="button"
                onClick={() => void onDelete(selectedRawFile)}
                disabled={deletingPath !== null}
                aria-label={deletingPath === selectedRawFile ? "Deleting file" : "Delete file"}
                title={deletingPath === selectedRawFile ? "Deleting..." : "Delete file"}
                className="rounded p-2 text-danger hover:bg-danger/10 disabled:text-warm-400 disabled:hover:bg-transparent"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v11m4-11v11m5-11v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
        <FileView path={selectedFilePath} mode="companion" />
      </div>
    </div>
  );
}

export function BrowsePage({ currentPath = "", onNavigate }: BrowsePageProps) {
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();

  // If currentPath points to a file, split into directory + filename
  const pathIsFile = isFilePath(currentPath);
  const dirPath = pathIsFile ? currentPath.split("/").slice(0, -1).join("/") : currentPath;
  const initialFile = pathIsFile ? currentPath : null;

  const { data, isLoading: loading } = trpc.status.browse.useQuery({ path: dirPath });
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialFile);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFilePath(initialFile);
  }, [initialFile]);

  useEffect(() => {
    setDeleteError(null);
    setContextMenu(null);
  }, [selectedFilePath]);

  useEffect(() => {
    if (contextMenu === null) return;

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Derive selected card metadata (for non-card files we just render via FileView)
  const selectedCard = selectedFilePath && data
    ? data.cards.find((c) => c.relativePath === selectedFilePath) || null
    : null;
  const selectedRawFile = selectedFilePath && isRawFilePath(selectedFilePath) ? selectedFilePath : null;

  // Build breadcrumb segments from the directory path
  const segments = dirPath ? dirPath.split("/").filter(Boolean) : [];

  const hasDetail = Boolean(selectedFilePath);

  const handleDelete = useCallback(async (path: string) => {
    if (deletingPath !== null) return;

    setContextMenu(null);
    setDeleteError(null);
    setDeletingPath(path);
    try {
      const response = await fetch(`${getApiBase()}/files/${path}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Delete failed (${response.status})`);
      }
      await utils.status.browse.invalidate({ path: dirPath });
      if (selectedFilePath === path) {
        setSelectedFilePath(null);
        onNavigate(dirPath);
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeletingPath(null);
    }
  }, [deletingPath, dirPath, onNavigate, selectedFilePath, utils.status.browse]);

  const handleFileContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, path: string) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, path });
  }, []);

  return (
    <div className="h-full flex">
      <Sidebar title="Browse" subtitle={dirPath || "/"} detailSelected={hasDetail}>
        <div className="flex flex-col">
          {/* Breadcrumbs — no whitespace between elements so it copies as a clean path. */}
          <div className="px-3 py-2 border-b text-sm break-words">
            <button
              onClick={() => onNavigate("")}
              className="text-primary hover:text-primary-dark hover:underline px-0.5"
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
                      className="text-primary hover:text-primary-dark hover:underline px-0.5"
                    >{seg}</button>
                  )}
                </Fragment>
              );
            })}
          </div>

          {data ? (
            <BrowseSidebarList
              boxSlug={boxSlug}
              data={data}
              dirPath={dirPath}
              loading={loading}
              onNavigate={onNavigate}
              selectedFilePath={selectedFilePath}
              onSelectFile={setSelectedFilePath}
              onFileContextMenu={handleFileContextMenu}
            />
          ) : loading ? (
            <div className="p-4 text-warm-600 text-sm">Loading...</div>
          ) : null}
        </div>
      </Sidebar>

      {/* Detail panel */}
      <div className={`flex-1 overflow-auto bg-warm-50 ${hasDetail ? "" : "hidden sm:block"}`}>
        {selectedFilePath ? (
          <BrowseDetailPanel
            boxSlug={boxSlug}
            deleteError={deleteError}
            deletingPath={deletingPath}
            onBack={() => setSelectedFilePath(null)}
            onDelete={handleDelete}
            selectedCard={selectedCard}
            selectedFilePath={selectedFilePath}
            selectedRawFile={selectedRawFile}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-warm-500">
            Select a file to view details
          </div>
        )}
      </div>
      {contextMenu !== null ? (
        <div
          className="fixed z-50 min-w-40 rounded-lg border border-warm-200 bg-white py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => void handleDelete(contextMenu.path)}
            disabled={deletingPath !== null}
            className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger/10 disabled:text-warm-400 disabled:hover:bg-transparent"
          >
            {deletingPath === contextMenu.path ? "Deleting..." : "Delete"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
