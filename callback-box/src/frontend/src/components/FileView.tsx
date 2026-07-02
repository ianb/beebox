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
import { getApiBase, withBase } from "../api";
import { useBusSubscription, type RealtimeEvent } from "../hooks/useBusSubscription";
import { getRenderers, type FileData, type FileRenderer } from "../renderers";
import type { NavigateHint, ViewTarget } from "../lib/view-url";
import type { ActivityKind } from "../../../core/chat-card-activity";
import { isBinaryPath, pathExt } from "../lib/binary-files";
import { boxRelativePath } from "@shared/box-path";
import { RequestError } from "../lib/errors";
import { SelectionCapture } from "./SelectionCapture";
import type { AddSelectionInput } from "../lib/selection-position";
import { Pre } from "./ui/Pre";
import { ViewRenderer } from "./ViewRenderer";
import { useCardViewBinding } from "../lib/view-bindings";
import { ExternalIconLink } from "./ui/ExternalIconLink";
import { OpenInPanelButton } from "./ui/OpenInPanelButton";
import { StatusBadge } from "./ui/StatusBadge";

export type FileViewMode = "page" | "chat" | "companion" | "embed";

interface FileViewProps {
  path: string;
  mode?: FileViewMode;
  /** Force a specific renderer by name (e.g. from a `?view=X` param). */
  rendererName?: string | null;
  /**
   * Required. Called when a link inside this view wants to open a different
   * file. The surrounding context decides what that means — pushing a URL,
   * replacing a sidebar pane, etc.
   */
  onNavigate: (target: ViewTarget, hint?: NavigateHint) => void;
  /**
   * Optional. When provided, text selections in the rendered document
   * surface a floating "+" that hands the selection to this callback (used
   * in the chat companion pane). Absent everywhere else — no affordance
   * without a composer to receive it.
   */
  onAddSelection?: (selection: AddSelectionInput) => void;
  /**
   * Optional. Report user activity on this card to the chat's companion-pane
   * accumulator. Threaded into agent-generated views (writes → `"modified"`,
   * `reportActivity("explored")` opt-in). Absent outside the companion pane.
   */
  reportActivity?: (kind: ActivityKind, detail?: string) => void;
  /**
   * Optional. When provided (chat-embedded cards only), the chat header shows
   * an "open in sidebar" button beside open-in-new-tab that escalates this
   * card into the companion pane. Absent where no companion pane exists.
   */
  onOpenInPanel?: () => void;
  /**
   * Optional. Embed query params, forwarded to the active renderer's `params`.
   * Set on the embed path; absent elsewhere.
   */
  params?: Record<string, string>;
  /**
   * Optional. The `![caption](path)` caption, forwarded to a media renderer so
   * an embedded image/figure card shows it like a normal captioned image.
   */
  caption?: string;
}

/* ---------- path classification ---------- */

function isCardPath(path: string): boolean {
  return path.endsWith(".card");
}

function isDirectoryPath(path: string): boolean {
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
      const resp = await fetch(`${apiBase}/files/${path}`, { signal });
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
    if (isCard) {
      utils.card.get.invalidate({ path });
    } else if (fetchText) {
      textQuery.refetch();
    }
  }, [path, isCard, fetchText, utils, textQuery]);
  // Skip the very first connect — the queries already load on mount, so a resync
  // there is a redundant refetch (and FileView is mounted many-at-once in chat).
  const connectedOnceRef = useRef(false);
  useBusSubscription({
    onEvent: useCallback((event: RealtimeEvent) => {
      if (event.event !== "file-change") return;
      const d = event.data as { path?: string };
      // Tolerant compare: normalize both sides so a stray leading slash on this
      // view's path can't silently drop the event (the original refresh bug).
      if (typeof d.path !== "string") return;
      if (boxRelativePath(d.path) !== boxRelativePath(path)) return;
      resync();
    }, [path, resync]),
    onConnect: useCallback(() => {
      if (!connectedOnceRef.current) {
        connectedOnceRef.current = true;
        return;
      }
      resync();
    }, [resync]),
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

function displayName(path: string): string {
  const base = path.split("/").pop();
  if (!base) return path;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
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
  path, renderers, active, onSelect, onOpenInPanel,
}: {
  path: string;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
  onOpenInPanel?: () => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  const browseHref = withBase(`/${boxSlug}/browse/${path}`);
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{displayName(path)}</div>
        <div className="text-xs text-warm-500 truncate" title={path}>{path}</div>
      </div>
      <RendererToggle renderers={renderers} active={active} onSelect={onSelect} compact />
      {onOpenInPanel ? (
        <OpenInPanelButton onClick={onOpenInPanel} label="Open in sidebar" size="sm" />
      ) : null}
      <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
    </div>
  );
}

/** Page-mode header: path as title, metadata (type/status), renderer toggle. */
function PageHeader({
  data, renderers, active, onSelect,
}: {
  data: FileData;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
}) {
  const status = typeof data.frontmatter?.status === "string" ? data.frontmatter.status : null;
  return (
    <div className="p-4 pb-0">
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-warm-900 truncate" title={data.path}>{data.path}</h1>
          <div className="flex items-center gap-2 mt-1">
            {data.type ? <span className="text-sm text-warm-600">Type: {data.type}</span> : null}
            {status ? <StatusBadge status={status} /> : null}
          </div>
        </div>
        <RendererToggle renderers={renderers} active={active} onSelect={onSelect} />
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export function FileView({ path, mode: modeProp, rendererName, onNavigate, onAddSelection, reportActivity, onOpenInPanel, params, caption }: FileViewProps) {
  const mode = modeProp ?? "page";
  const { data, loading, error } = useFileData(path);

  const handleCapture = useCallback((selection: { text: string; position: string }) => {
    if (onAddSelection === undefined) return;
    const ref = path.startsWith("/") ? path : `/${path}`;
    onAddSelection({ ref, text: selection.text, position: selection.position });
  }, [onAddSelection, path]);

  // Track user's toggle selection scoped to the current path. When the path
  // changes, the stored path no longer matches so selection resets without
  // needing an effect.
  const [userSelection, setUserSelection] = useState<{ path: string; name: string } | null>(null);
  const selectForPath = useCallback((name: string) => {
    setUserSelection({ path, name });
    // Switching how the same card is viewed (Sandbox/Card Tree/XML/…) is an
    // "explored" action. No-op outside the companion pane (reportActivity unset).
    reportActivity?.("explored", `viewing as ${name}`);
  }, [path, reportActivity]);

  // A box view exporting `rendersCardTypes` becomes this card type's
  // default renderer; the built-ins stay available through the toggle.
  const binding = useCardViewBinding(data?.type);
  const renderers: FileRenderer[] = useMemo(() => {
    const base = data ? getRenderers(path, data) : [];
    if (binding === null || !data) return base;
    const Bound = () => (
      <ViewRenderer
        slug={binding.slug}
        mode={mode === "chat" ? "chat" : "page"}
        // Link/embed query params (e.g. `?view=…&k=v`) reach the view; `path`
        // is the card's own path and is authoritative (can't be clobbered).
        params={{ ...params, path }}
        {...(reportActivity !== undefined ? { reportActivity } : {})}
        onNavigate={onNavigate}
        renderInline={(cardPath) => <FileView path={cardPath} mode="embed" onNavigate={onNavigate} />}
      />
    );
    return [{ name: binding.name, Component: Bound, priority: 100 }, ...base];
  }, [path, data, binding, mode, reportActivity, onNavigate, params]);

  if (loading) return <div className="p-4 text-warm-600">Loading...</div>;
  if (error) {
    return (
      <div className="p-4 text-danger-dark">
        <p className="font-medium">Error loading {path}</p>
        <div className="mt-1"><Pre size="sm" error>{error}</Pre></div>
      </div>
    );
  }
  if (!data) return <div className="p-4 text-warm-600">File not found: {path}</div>;

  const userName = userSelection && userSelection.path === path ? userSelection.name : null;
  const requested = userName ?? rendererName ?? null;
  const active = (requested ? renderers.find(r => r.name === requested) : undefined) ?? renderers[0];

  if (!active) {
    return <div className="p-4 text-warm-600">No renderer available for this file.</div>;
  }

  const rendered = <active.Component data={data} onNavigate={onNavigate} params={params} mode={mode} caption={caption} />;
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
        <ChatHeader path={path} renderers={renderers} active={active} onSelect={selectForPath} onOpenInPanel={onOpenInPanel} />
        <div className="max-h-96 overflow-auto">{body}</div>
      </div>
    );
  }

  if (mode === "companion") {
    // The surrounding panel provides the path+open-link header. Just show a
    // compact toggle row if there are alternates.
    return (
      <div>
        {renderers.length > 1 ? (
          <div className="flex justify-end px-3 py-2 border-b border-warm-200 print:hidden">
            <RendererToggle renderers={renderers} active={active} onSelect={selectForPath} compact />
          </div>
        ) : null}
        {body}
      </div>
    );
  }

  // page mode
  return (
    <div>
      <PageHeader data={data} renderers={renderers} active={active} onSelect={selectForPath} />
      {body}
    </div>
  );
}
