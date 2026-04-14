/**
 * Card file viewer.
 *
 * Fetches card data via tRPC card.get and uses the renderer registry
 * to find the best card-type-specific renderer. Falls back to CardTreeView.
 */

import { useCallback } from "react";
import { trpc } from "../lib/trpc";
import { getRenderers, type FileData } from "../renderers/index";
import { CardTreeView } from "../components/CardTreeView";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { getEventSourceBase } from "../api";
import { ChatViewerHeader } from "./chat-header";
import { registerFileViewer, type FileViewerProps } from "./registry";

function CardViewer({ filePath, mode }: FileViewerProps) {
  const utils = trpc.useUtils();
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
        <ChatViewerHeader filePath={filePath} />
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
