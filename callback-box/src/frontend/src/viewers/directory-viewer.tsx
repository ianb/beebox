/**
 * Directory viewer — renders a directory listing inline.
 *
 * Uses /api/browse/{path} to list contents. Shown when a view: link
 * points to a directory path (trailing slash or no file extension).
 */

import { useState, useEffect, useRef } from "react";
import { getApiBase } from "../api";
import { registerFileViewer, type FileViewerProps } from "./registry";

interface BrowseResult {
  path: string;
  dirs: string[];
  cards: Array<{
    relativePath: string;
    name: string;
    type: string;
    tagName: string;
    status?: string;
  }>;
}

function DirectoryViewer({ filePath, mode }: FileViewerProps) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiBase = getApiBase();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const resp = await fetch(`${apiBase}/browse/${filePath}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!resp.ok) {
          setError(`Failed to load: ${resp.status} ${resp.statusText}`);
          return;
        }
        setData(await resp.json());
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => controller.abort();
  }, [apiBase, filePath]);

  if (error) {
    return (
      <div className="p-4 text-red-600">
        <p className="font-medium">Error loading {filePath}</p>
        <pre className="text-sm mt-1">{error}</pre>
      </div>
    );
  }

  if (data === null) {
    return <div className="p-4 text-warm-600">Loading...</div>;
  }

  const isEmpty = data.dirs.length === 0 && data.cards.length === 0;

  const containerClass = mode === "chat"
    ? "max-h-96 overflow-auto border rounded-lg p-3"
    : "p-4";

  return (
    <div className={containerClass}>
      <div className="text-sm font-mono text-warm-500 mb-2">{filePath}/</div>
      {isEmpty ? <div className="text-warm-500 text-sm">Empty directory</div> : null}
      <ul className="text-sm space-y-0.5">
        {data.dirs.map((dir) => (
          <li key={dir} className="font-mono">
            <span className="text-warm-400 mr-1">/</span>
            {dir}
          </li>
        ))}
        {data.cards.map((card) => (
          <li key={card.relativePath} className="font-mono flex items-center gap-2">
            <span className="text-warm-700">{card.name}</span>
            <span className="text-warm-400 text-xs">.{card.type}.card</span>
            {card.status ? (
              <span className="text-xs px-1.5 py-0.5 rounded bg-warm-100 text-warm-600">{card.status}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Detect directory paths: trailing slash, or no file extension */
function isDirectoryPath(filePath: string): boolean {
  if (filePath.endsWith("/")) return true;
  const lastSegment = filePath.split("/").pop() || "";
  return !lastSegment.includes(".");
}

registerFileViewer({
  name: "directory",
  Component: DirectoryViewer,
  priority: 60,
  match: isDirectoryPath,
});
