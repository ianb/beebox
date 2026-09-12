/**
 * BrowsePage - File browser for _content/ and other box directories.
 *
 * Full-width directory listing for the canonical Browse card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { apiRawFileUrl, getApiBase } from "../../api";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { isRecord } from "@shared/is-record";
import { type ViewTarget } from "../../lib/view-url";
import { Sidebar } from "../../components/Sidebar";
import { trpc } from "../../lib/trpc";
import { BrowseBreadcrumbs } from "./components/BrowseBreadcrumbs";
import { BrowseContextMenu } from "./components/BrowseContextMenu";
import { Column } from "../../components/ui/Column";
import { Text } from "../../components/ui/Text";
import { BrowseSidebarBody } from "./components/BrowseSidebarBody";
import { RequestError } from "../../lib/errors";
import type { BrowseMissingKind, BrowseState } from "../../lib/browse-card-state";

interface BrowseBodyProps {
  state: BrowseState;
  onNavigate: (path: string, options: { kind: BrowseMissingKind; replace?: boolean }) => void;
  onFileNavigate: (target: ViewTarget) => void;
  onLinkNavigate: (target: ViewTarget) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  path: string;
}

/**
 * Keep the browse directory listing live: refetch when a file directly inside
 * `dirPath` changes (a card's title/status edit, or an add/remove), and resync
 * on a *re*connect since transient file-change events aren't replayed. Without
 * this the sidebar stayed stale until a full reload — only the open detail
 * panel (FileView) self-updated. The initial connect is skipped (the query
 * already loads on mount).
 */
function useBrowseListLiveRefresh(dirPath: string): void {
  const utils = trpc.useUtils();
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const data = busEventData(event, "file-change");
      if (!data) return;
      const changed = data.path;
      const parent = changed.includes("/") ? changed.slice(0, changed.lastIndexOf("/")) : "";
      if (parent !== dirPath) return;
      void utils.status.browse.invalidate({ path: dirPath });
    }, [dirPath, utils]),
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      void utils.status.browse.invalidate({ path: dirPath });
    }, [dirPath, utils]),
  });
}

/** Listing and retained detail body, independent of the outer route. */
export function BrowseBody({ state, onNavigate, onFileNavigate, onLinkNavigate }: BrowseBodyProps) {
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const dirPath = state.directory;
  // `forDir`, not `identity`: the sidebar header renders the landmark's full
  // resolved link list (listed + derived + expand), which only `forDir`
  // carries. The place pill and title mark need just label/symbol, so they
  // read `identity` instead and this query no longer shares their cache
  // entry (`docs/implemented-plans/card-prominence.md`, "Split identity from resolution").
  const landmarkQuery = trpc.landmarks.forDir.useQuery({ dir: dirPath });
  const landmark = landmarkQuery.data?.landmark ?? null;

  const { data, isLoading: loading, isError, error: browseError, refetch } = trpc.status.browse.useQuery({ path: dirPath });
  useBrowseListLiveRefresh(dirPath);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

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

  const handleDelete = useCallback(async (path: string) => {
    if (deletingPath !== null) return;

    setContextMenu(null);
    setDeleteError(null);
    setDeletingPath(path);
    try {
      const response = await fetch(apiRawFileUrl(getApiBase(), path), {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const errText = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : undefined;
        throw new RequestError(errText || `Delete failed (${response.status})`);
      }
      await utils.status.browse.invalidate({ path: dirPath });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setDeletingPath(null);
    }
  }, [deletingPath, dirPath, utils.status.browse]);

  const handleFileContextMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>, path: string) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, path });
  }, []);

  return (
    <Column className="h-full">
      {deleteError ? <Text as="div" size="sm" tone="danger" className="p-3">{deleteError}</Text> : null}
      <Sidebar title="Browse" headingLevel="h2" subtitle={dirPath || "/"} fill idPrefix="bbx-browse-sidebar">
        <Column>
          <BrowseBreadcrumbs dirPath={dirPath} onNavigate={(path) => onNavigate(path, { kind: "directory" })} />
          <BrowseSidebarBody
            data={data}
            loading={loading}
            isError={isError}
            error={browseError}
            onRetry={() => { void refetch(); }}
            dirPath={dirPath}
            selectedFilePath={null}
            onNavigate={(path, kind) => kind === "directory" ? onNavigate(path, { kind }) : onFileNavigate({ path, viewer: null, params: {}, viewState: null })}
            onFileContextMenu={handleFileContextMenu}
            landmark={landmark}
            boxSlug={boxSlug ?? ""}
            onLinkNavigate={onLinkNavigate}
            landmarkError={landmarkQuery.error}
            onLandmarkRetry={() => { void landmarkQuery.refetch(); }}
          />
        </Column>
      </Sidebar>

      {contextMenu !== null ? (
        <BrowseContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          deletingPath={deletingPath}
          onDelete={handleDelete}
        />
      ) : null}
    </Column>
  );
}
