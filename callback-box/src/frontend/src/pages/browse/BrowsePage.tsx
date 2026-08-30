/**
 * BrowsePage - File browser for store/ and other directories.
 *
 * Sidebar with directory listing + card detail panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { apiRawFileUrl, getApiBase } from "../../api";
import { useBusSubscription, type RealtimeEvent } from "../../hooks/useBusSubscription";
import { busEventData } from "../../lib/bus-events";
import { isRecord } from "@shared/is-record";
import { type ViewTarget } from "../../lib/view-url";
import { Sidebar } from "../../components/Sidebar";
import { trpc, type RouterOutput } from "../../lib/trpc";
import { BrowseBreadcrumbs } from "./components/BrowseBreadcrumbs";
import { BrowseDetailPanel } from "./components/BrowseDetailPanel";
import { BrowseContextMenu } from "./components/BrowseContextMenu";
import { Row } from "../../components/ui/Row";
import { Column } from "../../components/ui/Column";
import { Text } from "../../components/ui/Text";
import { BrowseSidebarBody } from "./components/BrowseSidebarBody";
import { usePageTitle } from "../../components/DocumentTitle";
import { useUrlView } from "../../hooks/useUrlView";
import { RequestError } from "../../lib/errors";
import { attachDirOwnerBasename, isAttachDirName } from "@shared/attach-path";
import { useAppBarPlace } from "../../components/app-bar-chrome";

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

export interface BrowseNavigateOptions {
  /** Query params for the target URL. Omitted/empty clears the current ones. */
  search?: Record<string, string>;
  /** Replace the current history entry instead of pushing a new one. */
  replace?: boolean;
}

interface BrowsePageProps {
  /** Current path from URL splat (e.g., "store/recipes" or "store/recipes/Foo.recipe.card") */
  currentPath?: string;
  /**
   * Called for every navigating action — opening a directory, selecting a
   * file, following a link, going back to the parent. The URL is the single
   * source of truth for what browse shows, so nothing changes the view
   * without going through here.
   */
  onNavigate: (path: string, options?: BrowseNavigateOptions) => void;
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
 * Publish browse's place to the app bar (docs/plans/top-nav-ia.md Track C2).
 *
 * The bar's own fallback (`lib/place-label.ts`) can only guess a route's
 * directory from the path, and any dotted last segment reads as a file there —
 * so `Foo.attach/`, a directory browse walks into, resolved no landmark and the
 * pill lost its "here" half. Browse has already classified the path, so it
 * hands the bar its answer rather than letting the heuristic disagree.
 */
function useBrowsePlace({ dirPath, currentPath }: { dirPath: string; currentPath: string }): void {
  useAppBarPlace({
    dir: dirPath,
    label: currentPath === "" ? "Browse" : `Browse: ${currentPath}`,
  });
}

/**
 * What this page calls itself in the browser tab.
 *
 * A selected file is named by its card title, a directory by its landmark —
 * the directory's own name for itself, and the one the app bar and the tab's
 * mark already use. Preferring it keeps a tab from naming a place differently
 * from the icon sitting beside it, which is what `store/recipes` titled
 * "recipes" next to a 🍳 did.
 */
function useBrowseTitle({
  dirPath,
  selectedFilePath,
  selectedCard,
  landmark,
}: {
  dirPath: string;
  selectedFilePath: string | null;
  selectedCard: { title?: string | null } | null;
  landmark: RouterOutput["landmarks"]["forDir"]["landmark"];
}): string {
  return useMemo(() => {
    if (selectedFilePath !== null && selectedFilePath !== "") {
      const cardTitle = selectedCard?.title?.trim();
      if (cardTitle) return cardTitle;
      const filename = selectedFilePath.split("/").pop() ?? selectedFilePath;
      return basenameTitle(filename);
    }
    if (dirPath) {
      const landmarkLabel = landmark?.label.trim();
      if (landmarkLabel) return landmarkLabel;
      const last = dirPath.split("/").pop() ?? dirPath;
      // Inside a card's attach scope, title by the owning card, not `Foo.attach`.
      return (attachDirOwnerBasename(last) ?? last).replace(/_/g, " ");
    }
    return "Browse";
  }, [selectedFilePath, selectedCard, dirPath, landmark]);
}

export function BrowsePage({ currentPath: currentPathArg, onNavigate }: BrowsePageProps) {
  const currentPath = currentPathArg ?? "";
  const { boxSlug } = useParams({ strict: false });
  const utils = trpc.useUtils();
  const { viewer, params: urlParams } = useUrlView();

  const pathIsFile = isFilePath(currentPath);
  const dirPath = pathIsFile ? currentPath.split("/").slice(0, -1).join("/") : currentPath;
  // What's open in the detail panel IS what the URL points at — no local
  // selection state to diverge from the route, so every file click is a
  // history entry the back button can walk.
  const selectedFilePath = pathIsFile ? currentPath : null;
  // Same query key as the place pill's and the title mark's, so the browse
  // header reuses their cache entry rather than adding a request.
  const landmarkQuery = trpc.landmarks.forDir.useQuery({ dir: dirPath }, { enabled: !selectedFilePath });
  const landmark = landmarkQuery.data?.landmark ?? null;

  const handleLinkNavigate = useCallback(
    (target: ViewTarget) => {
      // A link stays in the browse layout — navigating swaps the detail panel
      // and updates the URL, carrying the link's `?view=`/params along.
      const search = { ...target.params, ...(target.viewer ? { view: target.viewer } : {}) };
      // Re-rendering the file already open (a pure ?view=/param change) isn't a
      // new place: replace, so back leaves the file instead of undoing a toggle.
      onNavigate(target.path, { search, replace: target.path === currentPath });
    },
    [currentPath, onNavigate],
  );

  const handleSelectRenderer = useCallback(
    (name: string) => {
      // The renderer toggle is a view switch, so it belongs in the URL like
      // every other one — otherwise the choice sits in FileView's local state
      // where it outranks `?view=`, survives a same-path navigation, and can't
      // be shared or restored by back/forward. Replace: looking at the same
      // card a different way is not a new place.
      onNavigate(currentPath, { search: { ...urlParams, view: name }, replace: true });
    },
    [currentPath, onNavigate, urlParams],
  );

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
  const selectedRawFile = selectedFilePath && isRawFilePath(selectedFilePath) ? selectedFilePath : null;

  const hasDetail = Boolean(selectedFilePath);

  usePageTitle(useBrowseTitle({ dirPath, selectedFilePath, selectedCard, landmark }));
  useBrowsePlace({ dirPath, currentPath });

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
      <Sidebar title="Browse" subtitle={dirPath || "/"} detailSelected={hasDetail} idPrefix="cb-browse-sidebar">
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
          <BrowseDetailPanel
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
            onSelectRenderer={handleSelectRenderer}
            params={urlParams}
            rendererName={viewer}
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
