/**
 * View for displaying a card's content.
 *
 * Supports two view modes:
 * - Tree view: Structured display with Markdown rendering
 * - XML view: Syntax-highlighted raw XML
 */

import { useEffect, useState, useMemo } from "react";
import { getCard, type CardResponse } from "../api";
import { CardTreeView } from "./CardTreeView";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import "highlight.js/styles/github.css";

// Register XML language
hljs.registerLanguage("xml", xml);

type ViewMode = "tree" | "xml";

function HighlightedXml({ xml: xmlContent }: { xml: string }) {
  const highlighted = useMemo(() => {
    return hljs.highlight(xmlContent, { language: "xml" }).value;
  }, [xmlContent]);

  return (
    <div className="bg-gray-100 rounded p-4 overflow-auto">
      <pre className="text-sm whitespace-pre-wrap font-mono">
        <code
          className="hljs"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

interface CardViewProps {
  path: string;
  /** Initial view mode */
  defaultView?: ViewMode;
}

export function CardView({ path, defaultView = "tree" }: CardViewProps) {
  const [card, setCard] = useState<CardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);

  useEffect(() => {
    const fetchCard = async () => {
      try {
        setLoading(true);
        const data = await getCard(path);
        setCard(data);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
        setCard(null);
      } finally {
        setLoading(false);
      }
    };

    fetchCard();
  }, [path]);

  if (loading) {
    return <div className="p-4 text-gray-500">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error}</div>;
  }

  if (!card) {
    return <div className="p-4 text-gray-500">Card not found</div>;
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{card.path}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-gray-500">Type: {card.tagName}</span>
            {card.status && (
              <span className={`status-badge status-${card.status}`}>
                {card.status}
              </span>
            )}
            {card.version && (
              <span className="text-sm text-gray-400">v{card.version}</span>
            )}
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("tree")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "tree"
                ? "bg-white shadow text-gray-900"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Tree
          </button>
          <button
            onClick={() => setViewMode("xml")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "xml"
                ? "bg-white shadow text-gray-900"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            XML
          </button>
        </div>
      </div>

      {/* Content */}
      {viewMode === "tree" && card.element ? (
        <CardTreeView element={card.element} />
      ) : (
        <HighlightedXml xml={card.xml} />
      )}
    </div>
  );
}
