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

import { ThemedFileCard } from "./themes/ThemedFileCard";
import { useConversationCard, selectionReceiver } from "./chat/everywhere/card-context";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "@tanstack/react-router";
import { displayName } from "../lib/display-name";
import { useFileData, isCardPath, isMissingCardFailure } from "./file-view-data";
import type { LoadFailure } from "../lib/file-load-state";
import { withBase } from "../api";
import { getRenderers, type FileData, type FileRenderer } from "../renderers";
import { rendererDisplayLabel } from "../lib/renderer-display-label";
import { toDisplayPath } from "@shared/display-path";
import { SelectionCapture } from "./SelectionCapture";
import { Pre } from "./ui/Pre";
import { Button } from "./ui/Button";
import { ActiveFileRenderer, AuthoredRendererMarker } from "./ActiveFileRenderer";
import { useCardViewBinding } from "../lib/view-bindings";
import { ExternalIconLink } from "./ui/ExternalIconLink";
import { OpenInPanelButton } from "./ui/OpenInPanelButton";
import { StatusBadge } from "./ui/StatusBadge";
import { CardActions } from "./card-actions/CardActions";
import { usePageTitle } from "./DocumentTitle";
import { MissingCardState } from "./card-actions/MissingCardState";
import { FileStaleNotice } from "./FileStaleNotice";
import type { FileViewProps } from "./file-view-types";

export type { FileViewMode } from "./file-view-types";

/* ---------- chrome helpers ---------- */

/** The card's own display title, when its frontmatter carries one. */
function cardTitle(data: FileData): string | null {
  const title = data.frontmatter?.title;
  return typeof title === "string" && title.trim() !== "" ? title : null;
}

function RendererToggle({ renderers, active, onSelect, compact, path }: {
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
  compact?: boolean;
  path: string;
}) {
  if (renderers.length < 2) return null;
  // Sorted by descending priority (getRenderers): "Card" (30) leads only when no type-specific (100) renderer is registered.
  const hasTypeSpecificRenderer = renderers[0]?.name !== "Card";
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
          {rendererDisplayLabel({ registeredName: r.name, filePath: path, hasTypeSpecificRenderer })}
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
        <div className="text-xs text-warm-500 truncate" title={toDisplayPath(path)}>{toDisplayPath(path)}</div>
      </div>
      <RendererToggle renderers={renderers} active={active} onSelect={onSelect} compact path={path} />
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
          <h1 className="text-lg font-bold text-warm-900 truncate" title={toDisplayPath(data.path)}>
            {cardTitle(data) ?? displayName(data.path)}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-warm-500 truncate" title={toDisplayPath(data.path)}>{toDisplayPath(data.path)}</span>
            {status ? <StatusBadge status={status} /> : null}
          </div>
        </div>
        <div className="flex items-center gap-1"><RendererToggle renderers={renderers} active={active} onSelect={onSelect} path={data.path} />{isCardPath(data.path) ? <CardActions path={data.path} onTrashed={onTrashed} /> : null}</div>
      </div>
    </div>
  );
}

/**
 * The hard-failure state: nothing loaded, and the failure is not a missing
 * card. It offers the same Try again the stale marker does — a card opened
 * while the box is restarting has no previous body to fall back on, and
 * reloading the whole page should not be the only way forward.
 */
function FileErrorState({ path, failure, onRetry }: { path: string; failure: LoadFailure; onRetry: () => void }) {
  return (
    <div className="p-4 text-danger-dark">
      <p className="font-medium">{failure.headline}</p>
      <p className="text-sm mt-1">Could not load {toDisplayPath(path)}.</p>
      <div className="mt-1"><Pre size="sm" error>{failure.detail}</Pre></div>
      <div className="mt-2"><Button intent="secondary" size="sm" onClick={onRetry}>Try again</Button></div>
    </div>
  );
}

function selectedRenderer({ path, userSelection, rendererName }: {
  path: string; userSelection: { path: string; name: string | null } | null; rendererName?: string | null;
}) { return userSelection?.path === path ? userSelection.name : rendererName; }

function useMovedCardRecovery({
  path,
  recovery,
  onMoved,
  hasData,
}: {
  path: string;
  recovery: { path: string } | null;
  onMoved: ((path: string) => void) | undefined;
  hasData: boolean;
}): boolean {
  const handledMoveRef = useRef<string | null>(null);
  useEffect(() => {
    if (recovery === null || onMoved === undefined) return;
    const moveKey = `${path}\0${recovery.path}`;
    if (handledMoveRef.current === moveKey) return;
    handledMoveRef.current = moveKey;
    onMoved(recovery.path);
  }, [onMoved, path, recovery]);
  return recovery !== null && onMoved !== undefined && !hasData;
}

function pendingFileViewLabel({
  loading,
  followingMove,
}: {
  loading: boolean;
  followingMove: boolean;
}): string | null {
  if (loading) return "Loading...";
  if (followingMove) return "Following moved card...";
  return null;
}

/* ---------- main component ---------- */

export function FileView({ path, mode: modeProp, rendererName, onSelectRenderer, onNavigate, onMoved, onAddSelection: suppliedAddSelection, reportActivity, onOpenInPanel, params, viewState: ownedViewState, canPushViewState: canPushArg, onViewStateChange: ownedStateChange, caption, onClose }: FileViewProps) {
  const mode = modeProp ?? "page";
  const [userSelection, setUserSelection] = useState<{ path: string; name: string | null } | null>(null);
  const cardContext = useConversationCard({ path, mode, rendererName: selectedRenderer({ path, userSelection, rendererName }), params, viewState: ownedViewState });
  const onAddSelection = selectionReceiver(suppliedAddSelection, cardContext.capture);
  const handleCardFocus = cardContext.handleFocus;
  const handleRendererFocus = cardContext.handleRendererFocus;
  const { data, loading, error, stale, recovery, refresh } = useFileData(path);
  const followingMove = useMovedCardRecovery({ path, recovery, onMoved, hasData: data !== null });

  const handleCapture = useCallback((selection: { text: string; position: string }) => {
    if (onAddSelection === undefined) return;
    const ref = path.startsWith("/") ? path : `/${path}`;
    onAddSelection({ ref, text: selection.text, position: selection.position });
  }, [onAddSelection, path]);

  const selectForPath = useCallback((name: string | null) => {
    // Switching how the same card is viewed (Sandbox/Card Tree/XML/…) is an
    // "explored" action. No-op outside the companion pane (reportActivity unset).
    reportActivity?.("explored", name === null ? "using preferred view" : `viewing as ${name}`);
    handleRendererFocus(name);
    if (onSelectRenderer) {
      onSelectRenderer(name);
      return;
    }
    setUserSelection({ path, name });
  }, [onSelectRenderer, path, reportActivity, handleRendererFocus]);

  const binding = useCardViewBinding(data?.type);
  const renderers: FileRenderer[] = useMemo(() => {
    const base = data ? getRenderers(path, data) : [];
    if (binding === null || !data) return base;
    return [{ name: binding.name, Component: AuthoredRendererMarker, priority: 100 }, ...base];
  }, [path, data, binding]);

  const pendingLabel = pendingFileViewLabel({ loading, followingMove });
  if (pendingLabel !== null) return <div className="p-4 text-warm-600">{pendingLabel}</div>;
  // A missing card is not an error state: it falls through to MissingCardState,
  // which offers to create or close it.
  if (error !== null && !isMissingCardFailure(path, error)) return <FileErrorState path={path} failure={error} onRetry={refresh} />;
  if (!data) return isCardPath(path) ? <MissingCardState path={path} onClose={onClose} /> : <div className="p-4 text-warm-600">File not found: {toDisplayPath(path)}</div>;

  const hasUserSelection = userSelection?.path === path;
  const requested = hasUserSelection ? userSelection.name : rendererName ?? null;
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
  const captured = onAddSelection === undefined
    ? rendered
    : <SelectionCapture onCapture={handleCapture}>{rendered}</SelectionCapture>;
  // The marker rides with the body rather than with each mode's chrome, so a
  // card reports the same state wherever it renders — in chat, in the sidecar,
  // and on its own page.
  const body = stale === null ? captured : (
    <>
      <FileStaleNotice failure={stale} onRefresh={refresh} />
      {captured}
    </>
  );

  if (mode === "embed") {
    // Frameless: just the renderer output, no header/toggle/border. For figures
    // and other media embedded inline in a card body via `![](view:…)`. No
    // stale marker either — an embed has no chrome to carry one, and the card
    // that hosts it reports its own staleness.
    return captured;
  }

  if (isCardPath(path)) {
    return <ThemedFileCard key={path} data={data} mode={mode} renderers={renderers}
      active={active} hasExplicitView={requested !== null} onSelect={selectForPath} onNavigate={onNavigate} onFocus={handleCardFocus}
      onClose={onClose} onOpenInPanel={onOpenInPanel}>{body}</ThemedFileCard>;
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
      <div onPointerDownCapture={handleCardFocus} onFocusCapture={handleCardFocus} className="flex flex-col min-h-full">
        {renderers.length > 1 || isCardPath(data.path) ? (
          <div className="flex-shrink-0 flex items-center justify-end gap-1 px-3 py-2 border-b border-warm-200 print:hidden">
            <RendererToggle renderers={renderers} active={active} onSelect={selectForPath} compact path={data.path} />
            {isCardPath(data.path) ? <CardActions path={data.path} onTrashed={onClose} /> : null}
          </div>
        ) : null}
        <div className="flex-1 min-h-0">{body}</div>
      </div>
    );
  }

  return (
    <div onPointerDownCapture={handleCardFocus} onFocusCapture={handleCardFocus}>
      <PageHeader data={data} renderers={renderers} active={active} onSelect={selectForPath} onTrashed={onClose} />
      {body}
    </div>
  );
}
