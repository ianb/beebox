/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { getApiBase } from "../api";
import { Sidebar } from "../components/Sidebar";
import { trpc } from "../lib/trpc";
import { BrowseSidebarList } from "../components/browse/BrowseSidebarList";
import { BrowseBreadcrumbs } from "../components/browse/BrowseBreadcrumbs";
import { BrowseDetailPanel } from "../components/browse/BrowseDetailPanel";
import { BrowseContextMenu } from "../components/browse/BrowseContextMenu";
import { Row } from "../components/ui/Row";
import { Column } from "../components/ui/Column";
import { Text } from "../components/ui/Text";

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

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

export function BrowsePage({ currentPath = "", onNavigate }: BrowsePageProps) {
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();

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

  const selectedCard = selectedFilePath && data
    ? data.cards.find((c) => c.relativePath === selectedFilePath) || null
    : null;
  const selectedRawFile = selectedFilePath && isRawFilePath(selectedFilePath) ? selectedFilePath : null;

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
    <Row gap="none" align="stretch" className="h-full">
      <Sidebar title="Browse" subtitle={dirPath || "/"} detailSelected={hasDetail}>
        <Column>
          <BrowseBreadcrumbs dirPath={dirPath} onNavigate={onNavigate} />
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
            <Text as="div" size="sm" tone="subtle" className="p-4">Loading...</Text>
          ) : null}
        </Column>
      </Sidebar>

      <Column overflow="auto" hideOnMobile={!hasDetail} className="flex-1">
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
          <Row justify="center" align="center" className="h-full">
            <Text tone="muted">Select a file to view details</Text>
          </Row>
        )}
      </Column>
      {contextMenu !== null ? (
        <BrowseContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          deletingPath={deletingPath}
          onDelete={handleDelete}
        />
      ) : null}
    </Row>
  );
}
