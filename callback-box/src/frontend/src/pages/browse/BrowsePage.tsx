/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouterState } from "@tanstack/react-router";
import { getApiBase } from "../../api";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { isRecord } from "../../lib/is-record";
import { type ViewTarget } from "../../lib/view-url";
import { Sidebar } from "../../components/Sidebar";
import { trpc } from "../../lib/trpc";
import { BrowseSidebarList } from "./components/BrowseSidebarList";
import { BrowseBreadcrumbs } from "./components/BrowseBreadcrumbs";
import { BrowseDetailPanel } from "./components/BrowseDetailPanel";
import { BrowseContextMenu } from "./components/BrowseContextMenu";
import { Row } from "../../components/ui/Row";
import { Column } from "../../components/ui/Column";
import { Text } from "../../components/ui/Text";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { RequestError } from "../../lib/errors";
import { attachDirOwnerBasename, isAttachDirName } from "@shared/attach-path";

/**
 * Strip a trailing extension and convert underscores to spaces.
 * `UGMA_Transfer_Letter.md` → `UGMA Transfer Letter`.
 * Card files have two extensions (`Foo.memo.card`); strip both.
 */
function basenameTitle(filename: string): string {
  let stem = filename;
  if (stem.endsWith(".card")) {
    stem = stem.slice(0, -".card".length);
    const dot = stem.lastIndexOf(".");
    if (dot > 0) stem = stem.slice(0, dot);
  } else {
    const dot = stem.lastIndexOf(".");
    if (dot > 0) stem = stem.slice(0, dot);
  }
  return stem.replace(/_/g, " ");
}

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
  // `<basename>.attach` is a card's attach scope — a directory we browse into,
  // not a file — despite carrying a dotted suffix.
  if (isAttachDirName(base)) return false;
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

/**
 * Query params on the browse URL, for the detail panel's renderer —
 * runtime overrides on view-card params (the `view` key stays reserved
 * for renderer selection, mirroring view: URL semantics).
 */
function useBrowseUrlParams(): Record<string, string> {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(searchStr)) {
      if (key !== "view") out[key] = value;
    }
    return out;
  }, [searchStr]);
}

export function BrowsePage({ currentPath: currentPathArg, onNavigate }: BrowsePageProps) {
  const currentPath = currentPathArg ?? "";
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const urlParams = useBrowseUrlParams();

  const handleLinkNavigate = useCallback(
    (target: ViewTarget) => {
      // A link stays in the browse layout — navigating to a new file path swaps
      // the detail panel and updates the URL via onNavigate.
      onNavigate(target.path);
    },
    [onNavigate],
  );

  const pathIsFile = isFilePath(currentPath);
  const dirPath = pathIsFile ? currentPath.split("/").slice(0, -1).join("/") : currentPath;
  const initialFile = pathIsFile ? currentPath : null;

  const { data, isLoading: loading } = trpc.status.browse.useQuery({ path: dirPath });
  useBrowseListLiveRefresh(dirPath);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(initialFile);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  // Reset selection / clear transient errors when navigation changes
  // the file. Both are "external signal → local state" syncs; the
  // values can't be derived in render because they're decoupled from
  // initialFile (selection can change without nav, and contextMenu /
  // deleteError live independently of selection until the prop moves).

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

  const pageTitle = useMemo(() => {
    if (selectedFilePath) {
      const cardTitle = selectedCard?.title?.trim();
      if (cardTitle) return cardTitle;
      const filename = selectedFilePath.split("/").pop() ?? selectedFilePath;
      return basenameTitle(filename);
    }
    if (dirPath) {
      const last = dirPath.split("/").pop() ?? dirPath;
      // Inside a card's attach scope, title by the owning card, not `Foo.attach`.
      return (attachDirOwnerBasename(last) ?? last).replace(/_/g, " ");
    }
    return "Browse";
  }, [selectedFilePath, selectedCard, dirPath]);

  useDocumentTitle(pageTitle);

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
        const payload: unknown = await response.json().catch(() => null);
        const errText = isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : undefined;
        throw new RequestError(errText || `Delete failed (${response.status})`);
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
            onNavigate={handleLinkNavigate}
            params={urlParams}
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
