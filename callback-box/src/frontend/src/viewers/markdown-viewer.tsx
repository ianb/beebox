/**
 * Markdown file viewer.
 *
 * Fetches .md content from /api/files/{path} and renders via the shared
 * Markdown component. Subscribes to SSE for live reload.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase, getEventSourceBase } from "../api";
import { Markdown } from "../components/Markdown";
import { useSSE, type SSEEvent } from "../hooks/useSSE";
import { ChatViewerHeader } from "./chat-header";
import { registerFileViewer, type FileViewerProps } from "./registry";

function MarkdownViewer({ filePath, mode }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const apiBase = getApiBase();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const resp = await fetch(`${apiBase}/files/${filePath}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!resp.ok) {
          setError(`Failed to load: ${resp.status} ${resp.statusText}`);
          return;
        }
        setContent(await resp.text());
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => controller.abort();
  }, [apiBase, filePath, version]);

  useSSE(`${getEventSourceBase()}/events`, {
    onEvent: useCallback((event: SSEEvent) => {
      if (event.event === "file-change") {
        const data = event.data as { path?: string };
        if (data.path === filePath) {
          setVersion(v => v + 1);
        }
      }
    }, [filePath]),
  });

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p className="font-medium">Error loading {filePath}</p>
        <pre className="text-sm mt-1">{error}</pre>
      </div>
    );
  }

  if (content === null) {
    return <div className="p-4 text-warm-600">Loading...</div>;
  }

  if (mode === "chat") {
    return (
      <div className="border rounded-lg overflow-hidden">
        <ChatViewerHeader filePath={filePath} />
        <div className="max-h-96 overflow-auto p-3">
          <div className="prose prose-sm max-w-none">
            <Markdown>{content}</Markdown>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="prose prose-sm max-w-none">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}

registerFileViewer({
  name: "markdown",
  Component: MarkdownViewer,
  priority: 50,
  match: (p) => p.endsWith(".md"),
});
