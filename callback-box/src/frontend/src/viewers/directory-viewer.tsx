/**
 * Directory viewer — renders a directory listing with expandable cards.
 *
 * Uses /api/browse/{path} to list contents. Cards expand inline as
 * accordions showing card content via CardTreeView.
 */

import { useState, useEffect, useRef } from "react";
import { getApiBase } from "../api";
import { trpc } from "../lib/trpc";
import { CardTreeView } from "../components/CardTreeView";
import { getRenderers, type FileData } from "../renderers/index";
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

interface CardAccordionProps {
  cardPath: string;
  name: string;
  type: string;
  status?: string;
}

function CardAccordion({ cardPath, name, type, status }: CardAccordionProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-warm-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-warm-50 transition-colors"
      >
        <span className={`text-warm-400 text-xs transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        <span className="text-sm font-medium text-warm-800">{name}</span>
        <span className="text-warm-400 text-xs">.{type}.card</span>
        {status ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-warm-100 text-warm-500">{status}</span>
        ) : null}
      </button>
      {open ? <CardAccordionBody cardPath={cardPath} /> : null}
    </div>
  );
}

function CardAccordionBody({ cardPath }: { cardPath: string }) {
  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path: cardPath });

  if (isLoading) {
    return <div className="px-3 py-2 text-warm-500 text-sm">Loading...</div>;
  }

  if (error || !card) {
    return <div className="px-3 py-2 text-red-500 text-sm">Failed to load card</div>;
  }

  const fileData: FileData = {
    path: card.path,
    tagName: card.tagName,
    element: card.element,
    xml: card.xml,
    version: card.version,
    status: card.status,
  };

  const renderers = getRenderers(cardPath, fileData);
  if (renderers.length > 0) {
    const Renderer = renderers[0].Component;
    return (
      <div className="border-t border-warm-200 px-3 py-2">
        <Renderer data={fileData} onNavigate={() => {}} />
      </div>
    );
  }

  if (card.element) {
    return (
      <div className="border-t border-warm-200 px-3 py-2">
        <CardTreeView element={card.element} path={card.path} version={card.version} />
      </div>
    );
  }

  return (
    <div className="border-t border-warm-200 px-3 py-2">
      <pre className="text-xs whitespace-pre-wrap">{card.xml}</pre>
    </div>
  );
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
    ? "max-h-[32rem] overflow-auto border rounded-lg p-3"
    : "p-4";

  return (
    <div className={containerClass}>
      <div className="text-sm font-mono text-warm-500 mb-2">{filePath}/</div>
      {isEmpty ? <div className="text-warm-500 text-sm">Empty directory</div> : null}
      {data.dirs.length > 0 ? (
        <ul className="text-sm space-y-0.5 mb-2">
          {data.dirs.map((dir) => (
            <li key={dir} className="font-mono">
              <span className="text-warm-400 mr-1">/</span>
              {dir}
            </li>
          ))}
        </ul>
      ) : null}
      {data.cards.length > 0 ? (
        <div className="space-y-1">
          {data.cards.map((card) => (
            <CardAccordion
              key={card.relativePath}
              cardPath={card.relativePath}
              name={card.name}
              type={card.type}
              status={card.status}
            />
          ))}
        </div>
      ) : null}
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
