/**
 * Card file viewer.
 *
 * Fetches card data via tRPC card.get and uses the renderer registry
 * to find the best card-type-specific renderer. Falls back to CardTreeView.
 */

import { useCallback } from "react";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../lib/trpc";
import { getRenderers, type FileData } from "../renderers/index";
import { CardTreeView } from "../components/CardTreeView";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { getEventSourceBase } from "../api";
import { href } from "../lib/routing";
import { registerFileViewer, type FileViewerProps } from "./registry";

function cardNameFromPath(path: string): string {
  const base = path.split("/").pop();
  if (!base) return path;
  return base.endsWith(".card") ? base.slice(0, -5) : base;
}

function ChatCardHeader({ filePath, boxSlug }: { filePath: string; boxSlug: string | undefined }) {
  const browseHref = href(`/${boxSlug}/browse/${filePath}`);
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-warm-300 bg-warm-50">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{cardNameFromPath(filePath)}</div>
        <div className="text-xs text-warm-500 truncate" title={filePath}>{filePath}</div>
      </div>
      <a
        href={browseHref}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 p-1 text-warm-500 hover:text-warm-700 rounded hover:bg-warm-200"
        title="Open in browse view (new tab)"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}

function CardViewer({ filePath, mode }: FileViewerProps) {
  const utils = trpc.useUtils();
  const { boxSlug } = useParams({ strict: false });
  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: filePath });

  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: useCallback((event: SSEEvent) => {
      if (event.event === "file-change") {
        const data = event.data as { path?: string };
        if (data.path === filePath) {
          utils.card.get.invalidate({ path: filePath });
        }
      }
    }, [filePath, utils]),
  });

  if (isLoading) {
    return <div className="p-4 text-warm-600">Loading...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p className="font-medium">Error loading {filePath}</p>
        <pre className="text-sm mt-1">{error.message}</pre>
      </div>
    );
  }

  if (!card) {
    return <div className="p-4 text-warm-600">Card not found: {filePath}</div>;
  }

  const fileData: FileData = {
    path: card.path,
    tagName: card.tagName,
    element: card.element,
    xml: card.xml,
    version: card.version,
    status: card.status,
  };

  // Try card-type-specific renderers from the renderer registry
  const renderers = getRenderers(filePath, fileData);
  const Renderer = renderers.length > 0 ? renderers[0].Component : null;
  const body = Renderer ? (
    <Renderer data={fileData} onNavigate={() => {}} />
  ) : card.element ? (
    <CardTreeView element={card.element} path={card.path} version={card.version} />
  ) : (
    <pre className="text-sm whitespace-pre-wrap">{card.xml}</pre>
  );

  if (mode === "chat") {
    return (
      <div className="border rounded-lg overflow-hidden">
        <ChatCardHeader filePath={filePath} boxSlug={boxSlug} />
        <div className="max-h-96 overflow-auto p-3">{body}</div>
      </div>
    );
  }

  return <div className="p-4">{body}</div>;
}

registerFileViewer({
  name: "card",
  Component: CardViewer,
  priority: 50,
  match: (p) => p.endsWith(".card"),
});
