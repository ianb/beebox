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

import { useState, useCallback, useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "../lib/trpc";
import { getApiBase, getEventSourceBase } from "../api";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { href } from "../lib/routing";
import { getRenderers, type FileData, type FileRenderer } from "../renderers";
import { Pre } from "./ui/Pre";
import { ExternalIconLink } from "./ui/ExternalIconLink";

export type FileViewMode = "page" | "chat" | "companion";

interface FileViewProps {
  path: string;
  mode?: FileViewMode;
  /** Force a specific renderer by name (e.g. from a `?view=X` param). */
  rendererName?: string | null;
}

/* ---------- path classification ---------- */

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico",
  ".mp3", ".m4a", ".mp4", ".wav", ".webm", ".ogg", ".aac", ".flac",
  ".pdf", ".zip",
]);

function lastExt(path: string): string {
  const base = path.split("/").pop();
  if (!base) return "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

function isCardPath(path: string): boolean {
  return path.endsWith(".card");
}

function isDirectoryPath(path: string): boolean {
  return lastExt(path) === "";
}

function isBinaryPath(path: string): boolean {
  return BINARY_EXTS.has(lastExt(path));
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
  const fetchText = !isCard && !isDir && !isBinary;
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
      if (!resp.ok) throw new Error(`Failed to load: ${resp.status} ${resp.statusText}`);
      return resp.text();
    },
  });

  // Live reload via SSE — invalidate appropriate cache on file-change events
  const utils = trpc.useUtils();
  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: useCallback((event: SSEEvent) => {
      if (event.event !== "file-change") return;
      const d = event.data as { path?: string };
      if (d.path !== path) return;
      if (isCard) {
        utils.card.get.invalidate({ path });
      } else if (fetchText) {
        textQuery.refetch();
      }
    }, [path, isCard, fetchText, utils, textQuery]),
  });

  return useMemo<LoadResult>(() => {
    if (isCard) {
      if (cardLoading) return { data: null, loading: true, error: null };
      if (cardError) return { data: null, loading: false, error: cardError.message };
      if (!card) return { data: null, loading: false, error: null };
      return {
        data: {
          path: card.path,
          tagName: card.tagName,
          attrs: card.element ? card.element.attrs : undefined,
          element: card.element,
          xml: card.xml,
          version: card.version,
          status: card.status,
        },
        loading: false,
        error: null,
      };
    }
    if (isDir || isBinary) {
      return { data: { path }, loading: false, error: null };
    }
    // fetchText
    if (textQuery.isLoading) return { data: null, loading: true, error: null };
    if (textQuery.error) return { data: null, loading: false, error: textQuery.error.message };
    if (textQuery.data === undefined) return { data: null, loading: true, error: null };
    return { data: { path, content: textQuery.data }, loading: false, error: null };
  }, [isCard, isDir, isBinary, path, card, cardLoading, cardError, textQuery.data, textQuery.isLoading, textQuery.error]);
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

/** Chat-mode header: name + full path (truncated, hover for full) + open-in-browse icon. */
function ChatHeader({
  path, renderers, active, onSelect,
}: {
  path: string;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
}) {
  const { boxSlug } = useParams({ strict: false });
  const browseHref = href(`/${boxSlug}/browse/${path}`);
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{displayName(path)}</div>
        <div className="text-xs text-warm-500 truncate" title={path}>{path}</div>
      </div>
      <RendererToggle renderers={renderers} active={active} onSelect={onSelect} compact />
      <ExternalIconLink href={browseHref} label="Open in browse view (new tab)" size="sm" />
    </div>
  );
}

/** Page-mode header: path as title, metadata (tagName/status/version), renderer toggle. */
function PageHeader({
  data, renderers, active, onSelect,
}: {
  data: FileData;
  renderers: FileRenderer[];
  active: FileRenderer;
  onSelect: (name: string) => void;
}) {
  return (
    <div className="p-4 pb-0">
      <div className="flex items-center justify-between mb-2 gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-warm-900 truncate" title={data.path}>{data.path}</h2>
          <div className="flex items-center gap-2 mt-1">
            {data.tagName ? <span className="text-sm text-warm-600">Type: {data.tagName}</span> : null}
            {data.status ? <span className={`status-badge status-${data.status}`}>{data.status}</span> : null}
            {data.version ? <span className="text-sm text-warm-500">v{data.version}</span> : null}
          </div>
        </div>
        <RendererToggle renderers={renderers} active={active} onSelect={onSelect} />
      </div>
    </div>
  );
}

/* ---------- main component ---------- */

export function FileView({ path, mode = "page", rendererName }: FileViewProps) {
  const { data, loading, error } = useFileData(path);

  // Track user's toggle selection scoped to the current path. When the path
  // changes, the stored path no longer matches so selection resets without
  // needing an effect.
  const [userSelection, setUserSelection] = useState<{ path: string; name: string } | null>(null);
  const selectForPath = useCallback((name: string) => {
    setUserSelection({ path, name });
  }, [path]);

  const renderers: FileRenderer[] = useMemo(
    () => (data ? getRenderers(path, data) : []),
    [path, data],
  );

  if (loading) return <div className="p-4 text-warm-600">Loading...</div>;
  if (error) {
    return (
      <div className="p-4 text-red-600">
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

  const body = <active.Component data={data} onNavigate={() => {}} />;

  if (mode === "chat") {
    return (
      <div className="border rounded-lg overflow-hidden bg-white">
        <ChatHeader path={path} renderers={renderers} active={active} onSelect={selectForPath} />
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
          <div className="flex justify-end px-3 py-2 border-b border-warm-200">
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
