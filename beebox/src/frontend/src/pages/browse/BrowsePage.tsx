/**
 * BrowsePage - File browser for _content/ and other box directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { apiRawFileUrl, getApiBase } from "../../api";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { isRecord } from "@shared/is-record";
import { type ViewState, type ViewTarget } from "../../lib/view-url";
import { Sidebar } from "../../components/Sidebar";
import { trpc } from "../../lib/trpc";
import { BrowseBreadcrumbs } from "./components/BrowseBreadcrumbs";
import { BrowseDetailPanel } from "./components/BrowseDetailPanel";
import { BrowseContextMenu } from "./components/BrowseContextMenu";
import { Row } from "../../components/ui/Row";
import { Column } from "../../components/ui/Column";
import { Text } from "../../components/ui/Text";
import { BrowseSidebarBody } from "./components/BrowseSidebarBody";
import { RequestError } from "../../lib/errors";
import type { BrowseState } from "../../lib/browse-card-state";
import { CardVisibilityProvider, useVisibleCardSelectionSink } from "../../components/chat/everywhere/card-context";

interface BrowseBodyProps {
  state: BrowseState;
  onNavigate: (path: string, options?: { replace?: boolean }) => void;
  onDetailNavigate: (target: ViewTarget, method: "push" | "replace") => void;
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
export function BrowseBody({ state, onNavigate, onDetailNavigate }: BrowseBodyProps) {
  const onAddSelection = useVisibleCardSelectionSink();
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const dirPath = state.directory;
  const selectedFilePath = state.detail?.path ?? null;
  const viewer = state.detail?.viewer ?? null;
  const urlParams = state.detail?.params ?? {};
  const viewState = state.detail?.viewState ?? null;
  // `forDir`, not `identity`: the sidebar header renders the landmark's full
  // resolved link list (listed + derived + expand), which only `forDir`
  // carries. The place pill and title mark need just label/symbol, so they
  // read `identity` instead and this query no longer shares their cache
  // entry (`docs/implemented-plans/card-prominence.md`, "Split identity from resolution").
  const landmarkQuery = trpc.landmarks.forDir.useQuery({ dir: dirPath }, { enabled: !selectedFilePath });
  const landmark = landmarkQuery.data?.landmark ?? null;

  const handleLinkNavigate = (target: ViewTarget) => {
    onDetailNavigate(target, target.path === selectedFilePath ? "replace" : "push");
  };
  const handleViewStateChange = (next: ViewState, method: "push" | "replace") => {
    if (state.detail) onDetailNavigate({ ...state.detail, viewState: next }, method);
  };
  const handleSelectRenderer = (name: string | null) => {
    if (state.detail) onDetailNavigate({ ...state.detail, viewer: name }, "replace");
  };

  const followMovedCard = useCallback((path: string) => {
    if (state.detail) onDetailNavigate({ ...state.detail, path }, "replace");
  }, [onDetailNavigate, state.detail]);

  const { data, isLoading: loading, isError, error: browseError, refetch } = trpc.status.browse.useQuery({ path: dirPath });
  useBrowseListLiveRefresh(dirPath);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  // Clear transient errors when navigation changes the file. An "external
  // signal → local state" sync: contextMenu / deleteError live independently
  // of the route until it moves, so they can't be derived in render.
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
  const selectedRawFile = selectedFilePath && data?.files.some((file) => file.relativePath === selectedFilePath) ? selectedFilePath : null;

  const hasDetail = Boolean(selectedFilePath);

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
      if (selectedFilePath === path) {
        // The file is gone — leaving its URL in history would let back walk
        // onto a 404, so replace the entry rather than push.
        onNavigate(dirPath, { replace: true });
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
      <Sidebar title="Browse" headingLevel="h2" subtitle={dirPath || "/"} detailSelected={hasDetail} idPrefix="bbx-browse-sidebar">
        <Column>
          <BrowseBreadcrumbs dirPath={dirPath} onNavigate={onNavigate} />
          <BrowseSidebarBody
            data={data}
            loading={loading}
            isError={isError}
            error={browseError}
            onRetry={() => { void refetch(); }}
            dirPath={dirPath}
            selectedFilePath={selectedFilePath}
            onNavigate={onNavigate}
            onFileContextMenu={handleFileContextMenu}
            landmark={landmark}
            boxSlug={boxSlug ?? ""}
            onLinkNavigate={handleLinkNavigate}
            landmarkError={landmarkQuery.error}
            onLandmarkRetry={() => { void landmarkQuery.refetch(); }}
          />
        </Column>
      </Sidebar>

      <Column overflow="auto" focusable hideOnMobile={!hasDetail} className="flex-1">
        {selectedFilePath ? (
          <CardVisibilityProvider visible={false}><BrowseDetailPanel
            boxSlug={boxSlug}
            deleteError={deleteError}
            deletingPath={deletingPath}
            onBack={() => {
              // Replace, not push: this button closes the file, so a browser
              // back right after it must not reopen the file it just closed.
              onNavigate(dirPath, { replace: true });
            }}
            onDelete={handleDelete}
            onNavigate={handleLinkNavigate}
            onMoved={followMovedCard}
            onSelectRenderer={handleSelectRenderer}
            onViewStateChange={handleViewStateChange}
            onAddSelection={onAddSelection}
            params={urlParams}
            rendererName={viewer}
            viewState={viewState}
            selectedCard={selectedCard}
            selectedFilePath={selectedFilePath}
            selectedRawFile={selectedRawFile}
          /></CardVisibilityProvider>
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
