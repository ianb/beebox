/**
 * FileView — unified file viewer shell.
 *
 * One component for every place a file is shown: inline in chat, in the
 * chat companion pane, in the browse detail panel, and on the full card
 * view page. Chooses the highest-priority registered renderer for the file
 * and offers a toggle between alternates.
 *
 * Responsibilities:
 *  - Load data for the file: card XML/element for .card files via tRPC;
 *    raw text content for other files via /api/files/*. Binary files
 *    (images, audio, etc.) and directories are passed through without
 *    loading content — their renderer handles the fetch.
 *  - Pick the active renderer from getRenderers() and render it.
 *  - Apply mode-specific chrome:
 *     - "chat"      — compact chat-header (name, path, open-in-new-tab),
 *                     max-height, scrollable, bordered.
 *     - "companion" — no extra chrome (the surrounding companion pane
 *                     provides its own header).
 *     - "page"      — full-page metadata header (path, status, version)
 *                     with renderer toggle.
 */

import { useState, useCallback, useMemo, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc";
import { displayName } from "../lib/display-name";
import { ATTACH_SUFFIX } from "@shared/attach-path";
import { apiRawFileUrl, getApiBase, withBase } from "../api";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { useDeferredResync } from "../hooks/useDeferredResync";
import { getRenderers, type FileData, type FileRenderer } from "../renderers";
import { isBinaryPath, pathExt } from "../lib/binary-files";
import { boxRelativePath } from "@shared/box-path";
import { RequestError } from "../lib/errors";
import { busEventData } from "../lib/bus-events";
import { SelectionCapture } from "./SelectionCapture";
import { Pre } from "./ui/Pre";
import { ActiveFileRenderer, AuthoredRendererMarker } from "./ActiveFileRenderer";
import { useCardViewBinding } from "../lib/view-bindings";
import { ExternalIconLink } from "./ui/ExternalIconLink";
import { OpenInPanelButton } from "./ui/OpenInPanelButton";
import { StatusBadge } from "./ui/StatusBadge";
import { CardActions } from "./card-actions/CardActions";
import { usePageTitle } from "./DocumentTitle";
import { MissingCardState } from "./card-actions/MissingCardState";
import type { FileViewProps } from "./file-view-types";

export type { FileViewMode } from "./file-view-types";

/* ---------- path classification ---------- */

function isCardPath(path: string): boolean {
  return path.endsWith(".card");
}

function isDirectoryPath(path: string): boolean {
  // An extension is a good proxy for "this is a file" except for the one
  // directory convention that carries a suffix: every card's attachments live in
  // a sibling `<basename>.attach/`. Classifying those as files sent the shell to
  // fetch a directory's body as text, so every attachment directory in every box
  // rendered "Failed to load: 404" on the card page while listing fine in Browse.
  // Only a path ENDING in the suffix is the directory itself; `foo.attach/photo.jpg`
  // is a file inside it and is classified by its own extension below.
  if (path.endsWith(ATTACH_SUFFIX)) return true;
  return pathExt(path) === "";
}

/**
 * JSON is fetched by its own renderer (renderers/json.tsx), which gates on
 * file size before pulling a potentially-huge body — so, like binary files,
 * the shell must not prefetch it as text.
 */
function isJsonPath(path: string): boolean {
  return pathExt(path) === ".json";
}

/* ---------- data loading ---------- */

interface LoadResult {
  data: FileData | null;
  loading: boolean;
  error: string | null;
}

function useFileData(path: string): LoadResult {
  const isCard = isCardPath(path);
  const isDir = isDirectoryPath(path);
  const isBinary = isBinaryPath(path);
  const isJson = isJsonPath(path);
  // JSON, like binary files, is loaded by its own renderer, so the shell
  // passes the path through without prefetching the body.
  const fetchText = !isCard && !isDir && !isBinary && !isJson;
  const apiBase = getApiBase();

  // Card data via tRPC
  const { data: card, isLoading: cardLoading, error: cardError } = trpc.card.get.useQuery(
    { path },
    { enabled: isCard },
  );

  // Text content via /api/files/* (managed by React Query)
  const textQuery = useQuery({
    queryKey: ["file-text", path],
    enabled: fetchText,
    queryFn: async ({ signal }) => {
      const resp = await fetch(apiRawFileUrl(apiBase, path), { signal });
      if (!resp.ok) {
        const message = `Failed to load: ${resp.status} ${resp.statusText}`;
        throw new RequestError(message);
      }
      return resp.text();
    },
  });

  // Live reload via the box event stream. Resync this file's data on a matching
  // `file-change`, and also on a *re*connect: file-change events are transient
  // and not replayed, so a change that landed while the socket was dropped would
  // otherwise leave the view stale until a manual reload.
  const utils = trpc.useUtils();
  const resync = useCallback(() => {
    // Fire-and-forget: both are react-query refresh triggers whose failure
    // surfaces through the query's own error/isError state, not here.
    if (isCard) {
      void utils.card.get.invalidate({ path });
    } else if (fetchText) {
      void textQuery.refetch();
    }
  }, [path, isCard, fetchText, utils, textQuery]);
  // Skip the very first connect — the queries already load on mount, so a resync
  // there is a redundant refetch (and FileView is mounted many-at-once in chat).
  const connectedOnceRef = useRef(false);
  // Reconnect-driven resync is per-instance (one per mounted FileView, i.e.
  // per path), coalesced same-tick and deferred while the tab is hidden — a
  // chat with many embedded files all reconnecting at once shouldn't each
  // fire their own refetch, and a backgrounded tab shouldn't fetch at all.
  const triggerResync = useDeferredResync(resync);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      const fileChange = busEventData(event, "file-change");
      if (!fileChange) return;
      // Tolerant compare: normalize both sides so a stray leading slash on this
      // view's path can't silently drop the event (the original refresh bug).
      if (boxRelativePath(fileChange.path) !== boxRelativePath(path)) return;
      resync();
    }, [path, resync]),
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      triggerResync();
    }, [triggerResync]),
  });

  return useMemo<LoadResult>(() => {
    if (isCard) {
      if (cardLoading) return { data: null, loading: true, error: null };
      if (cardError) return { data: null, loading: false, error: cardError.message };
      if (!card) return { data: null, loading: false, error: null };
      return {
        data: {
          path: card.path,
          kind: card.kind,
          type: card.type,
          frontmatter: card.frontmatter,
          body: card.body,
        },
        loading: false,
        error: null,
      };
    }
    if (isDir || isBinary || isJson) {
      return { data: { path }, loading: false, error: null };
    }
    // fetchText
    if (textQuery.isLoading) return { data: null, loading: true, error: null };
    if (textQuery.error) return { data: null, loading: false, error: textQuery.error.message };
    if (textQuery.data === undefined) return { data: null, loading: true, error: null };
    return { data: { path, content: textQuery.data }, loading: false, error: null };
  }, [isCard, isDir, isBinary, isJson, path, card, cardLoading, cardError, textQuery.data, textQuery.isLoading, textQuery.error]);
}

/* ---------- chrome helpers ---------- */

/** The card's own display title, when its frontmatter carries one. */
function cardTitle(data: FileData): string | null {
  const title = data.frontmatter?.title;
  return typeof title === "string" && title.trim() !== "" ? title : null;
}

function RendererToggle({
  renderers, active, onSelect, compact,
}: {
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
  compact?: boolean;
}) {
  if (renderers.length < 2) return null;
  return (
    <div className={`flex gap-1 bg-warm-100 rounded-lg ${compact ? "p-0.5" : "p-1"}`}>
      {renderers.map(r => (
        <button
          key={r.name}
          onClick={() => onSelect(r.name)}
          className={`${compact ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"} rounded ${
            r === active ? "bg-white shadow text-warm-900" : "text-warm-700 hover:text-warm-900"
          }`}
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}

/** Chat-mode header: name + full path (truncated, hover for full), open-in-sidebar + open-in-browse icons. */
function ChatHeader({
  path, title, renderers, active, onSelect, onOpenInPanel, onTrashed,
}: {
  path: string;
  /** The card's frontmatter title, when it has one — wins over the filename. */
  title: string | null;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
  onOpenInPanel?: () => void; onTrashed?: (() => void) | undefined;
}) {
  const { boxSlug } = useParams({ strict: false });
  const browseHref = withBase(`/${boxSlug}/browse/${path}`);
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{title ?? displayName(path)}</div>
        <div className="text-xs text-warm-500 truncate" title={path}>{path}</div>
      </div>
      <RendererToggle renderers={renderers} active={active} onSelect={onSelect} compact />
      <CardActions path={path} onTrashed={onTrashed} />
      {onOpenInPanel ? (
        <OpenInPanelButton onClick={onOpenInPanel} label="Open in sidebar" size="sm" />
      ) : null}
      <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
    </div>
  );
}

function PageHeader({
  data, renderers, active, onSelect, onTrashed,
}: {
  data: FileData;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
  onTrashed?: (() => void) | undefined;
}) {
  const status = typeof data.frontmatter?.status === "string" ? data.frontmatter.status : null;
  // The heading and the tab say the same thing. PageHeader renders only in
  // `page` mode -- the /card and /views routes -- so no embedded, companion,
  // or overlaid card can reach this and retitle the tab.
  usePageTitle(cardTitle(data) ?? displayName(data.path));
  return (
    <div className="p-4 pb-0">
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-warm-900 truncate" title={data.path}>
            {cardTitle(data) ?? displayName(data.path)}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-warm-500 truncate" title={data.path}>{data.path}</span>
            {status ? <StatusBadge status={status} /> : null}
          </div>
        </div>
        <div className="flex items-center gap-1"><RendererToggle renderers={renderers} active={active} onSelect={onSelect} />{isCardPath(data.path) ? <CardActions path={data.path} onTrashed={onTrashed} /> : null}</div>
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export function FileView({ path, mode: modeProp, rendererName, onSelectRenderer, onNavigate, onAddSelection, reportActivity, onOpenInPanel, params, viewState: ownedViewState, canPushViewState: canPushArg, onViewStateChange: ownedStateChange, caption, onClose }: FileViewProps) {
  const mode = modeProp ?? "page";
  const { data, loading, error } = useFileData(path);

  const handleCapture = useCallback((selection: { text: string; position: string }) => {
    if (onAddSelection === undefined) return;
    const ref = path.startsWith("/") ? path : `/${path}`;
    onAddSelection({ ref, text: selection.text, position: selection.position });
  }, [onAddSelection, path]);

  const [userSelection, setUserSelection] = useState<{ path: string; name: string } | null>(null);
  const selectForPath = useCallback((name: string) => {
    // Switching how the same card is viewed (Sandbox/Card Tree/XML/…) is an
    // "explored" action. No-op outside the companion pane (reportActivity unset).
    reportActivity?.("explored", `viewing as ${name}`);
    if (onSelectRenderer) {
      onSelectRenderer(name);
      return;
    }
    setUserSelection({ path, name });
  }, [onSelectRenderer, path, reportActivity]);

  const binding = useCardViewBinding(data?.type);
  const renderers: FileRenderer[] = useMemo(() => {
    const base = data ? getRenderers(path, data) : [];
    if (binding === null || !data) return base;
    return [{ name: binding.name, Component: AuthoredRendererMarker, priority: 100 }, ...base];
  }, [path, data, binding]);

  if (loading) return <div className="p-4 text-warm-600">Loading...</div>;
  if (error && !(isCardPath(path) && error.startsWith("Card not found:"))) {
    return (
      <div className="p-4 text-danger-dark">
        <p className="font-medium">Error loading {path}</p>
        <div className="mt-1"><Pre size="sm" error>{error}</Pre></div>
      </div>
    );
  }
  if (!data) return isCardPath(path) ? <MissingCardState path={path} onClose={onClose} /> : <div className="p-4 text-warm-600">File not found: {path}</div>;

  const userName = userSelection && userSelection.path === path ? userSelection.name : null;
  const requested = userName ?? rendererName ?? null;
  // renderers can be empty (no renderer matches this file); the frontend
  // tsconfig lacks noUncheckedIndexedAccess, so `renderers[0]` would type
  // `active` as always-defined. `.at(0)` is typed `T | undefined` regardless
  // of that flag, which keeps this check honest.
  const active = (requested ? renderers.find(r => r.name === requested) : undefined) ?? renderers.at(0);

  if (!active) {
    return <div className="p-4 text-warm-600">No renderer available for this file.</div>;
  }

  const rendered = (
    <ActiveFileRenderer
      active={active} binding={binding} data={data} path={path} mode={mode}
      params={params} viewState={ownedViewState} canPushViewState={canPushArg}
      {...(ownedStateChange !== undefined ? { onViewStateChange: ownedStateChange } : {})}
      {...(reportActivity !== undefined ? { reportActivity } : {})}
      onNavigate={onNavigate} caption={caption}
      renderInline={(target) => (
        <FileView
          path={target.path}
          mode="embed"
          rendererName={target.viewer}
          params={target.params}
          viewState={target.viewState}
          onNavigate={onNavigate}
        />
      )}
    />
  );
  const body = onAddSelection === undefined
    ? rendered
    : <SelectionCapture onCapture={handleCapture}>{rendered}</SelectionCapture>;

  if (mode === "embed") {
    // Frameless: just the renderer output, no header/toggle/border. For figures
    // and other media embedded inline in a card body via `![](view:…)`.
    return body;
  }

  if (mode === "chat") {
    return (
      <div className="border rounded-lg overflow-hidden bg-white">
        <ChatHeader path={path} title={cardTitle(data)} renderers={renderers} active={active} onSelect={selectForPath} onOpenInPanel={onOpenInPanel} onTrashed={onClose} />
        <div className="max-h-96 overflow-auto">{body}</div>
      </div>
    );
  }

  if (mode === "companion") {
    // The surrounding panel provides the path+open-link header. Just show a
    // compact toggle row if there are alternates.
    // Column flex with `min-h-full` so a renderer that wants to fill the pane
    // (the PDF frame) can take the leftover height, while a taller renderer
    // still grows past it and scrolls in the pane's own overflow-auto.
    return (
      <div className="flex flex-col min-h-full">
        {renderers.length > 1 || isCardPath(data.path) ? (
          <div className="flex-shrink-0 flex items-center justify-end gap-1 px-3 py-2 border-b border-warm-200 print:hidden">
            <RendererToggle renderers={renderers} active={active} onSelect={selectForPath} compact />
            {isCardPath(data.path) ? <CardActions path={data.path} onTrashed={onClose} /> : null}
          </div>
        ) : null}
        <div className="flex-1 min-h-0">{body}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader data={data} renderers={renderers} active={active} onSelect={selectForPath} onTrashed={onClose} />
      {body}
    </div>
  );
}
