/**
 * FileView — universal file viewer with pluggable renderers.
 *
 * Assembles a stack of applicable renderers for the current file,
 * defaults to the highest-priority one, and lets the user toggle between them.
 */

import { useEffect, useState } from "react";
import { getCard, type CardResponse } from "../api";
import { getRenderers, type FileData, type FileRenderer } from "../renderers";

interface FileViewProps {
  path: string;
}

export function FileView({ path }: FileViewProps) {
  const [data, setData] = useState<FileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRendererName, setActiveRendererName] = useState<string | null>(null);

  useEffect(() => {
    setActiveRendererName(null);
    const fetchData = async () => {
      try {
        setLoading(true);
        // For now, only .card files are supported via the existing API
        if (path.endsWith(".card")) {
          const card: CardResponse = await getCard(path);
          setData({
            path: card.path,
            tagName: card.tagName,
            attrs: card.element?.attrs,
            element: card.element,
            xml: card.xml,
            version: card.version,
            status: card.status,
          });
        } else {
          setData({ path });
        }
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [path]);

  if (loading) return <div className="p-4 text-warm-600">Loading...</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-4 text-warm-600">File not found</div>;

  const renderers = getRenderers(path, data);
  const current: FileRenderer | undefined =
    renderers.find(r => r.name === activeRendererName) ?? renderers[0];

  if (!current) {
    return <div className="p-4 text-warm-600">No renderer available for this file.</div>;
  }

  return (
    <div>
      {/* Header */}
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-bold text-warm-900">{data.path}</h2>
            <div className="flex items-center gap-2 mt-1">
              {data.tagName ? <span className="text-sm text-warm-600">Type: {data.tagName}</span> : null}
              {data.status ? <span className={`status-badge status-${data.status}`}>
                  {data.status}
                </span> : null}
              {data.version ? <span className="text-sm text-warm-500">v{data.version}</span> : null}
            </div>
          </div>

          {/* View toggle */}
          {renderers.length > 1 && (
            <div className="flex gap-1 bg-warm-100 rounded-lg p-1">
              {renderers.map(r => (
                <button
                  key={r.name}
                  onClick={() => setActiveRendererName(r.name)}
                  className={`px-3 py-1 text-sm rounded ${
                    r === current
                      ? "bg-white shadow text-warm-900"
                      : "text-warm-700 hover:text-warm-900"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Renderer */}
      <current.Component
        data={data}
        onNavigate={(p) => {
          // Navigate via window location for now; will be wired to router later
          window.location.hash = "";
          window.location.pathname = `/card/${p}`;
        }}
      />
    </div>
  );
}
