/**
 * View for displaying a card's content.
 *
 * Supports two view modes:
 * - Tree view: Structured display with Markdown rendering
 * - XML view: Syntax-highlighted raw XML
 */

import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { CardTreeView } from "./CardTreeView";
import { cbSource } from "../lib/source-tag";
import { Pre } from "./ui/Pre";
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
    <Pre boxed>
      <code
        className="hljs"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </Pre>
  );
}

interface CardViewProps {
  path: string;
  /** Initial view mode */
  defaultView?: ViewMode;
}

export function CardView({ path, defaultView = "tree" }: CardViewProps) {
  const { data: card, isLoading, error } = trpc.card.get.useQuery({ path });
  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);

  if (isLoading) {
    return <div className="p-4 text-warm-600">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">Error: {error.message}</div>;
  }

  if (!card) {
    return <div className="p-4 text-warm-600">Card not found</div>;
  }

  // Validation error — show error banner, then tree view if parseable or raw text if not
  if (card.validationError) {
    return (
      <div className="p-4" {...cbSource("card", path)}>
        <h2 className="text-lg font-bold text-warm-900 mb-2">{card.path}</h2>
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded">
          <div className="text-sm font-medium text-red-800 mb-1">Validation Error</div>
          <Pre size="xs" error>{card.validationError}</Pre>
        </div>
        {card.element ? (
          <CardTreeView element={card.element} />
        ) : (
          <Pre boxed>{card.xml}</Pre>
        )}
      </div>
    );
  }

  return (
    <div className="p-4" {...cbSource("card", path)}>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-warm-900">{card.path}</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm text-warm-600">Type: {card.tagName}</span>
            {card.status ? <span className={`status-badge status-${card.status}`}>
                {card.status}
              </span> : null}
            {card.version ? <span className="text-sm text-warm-500">v{card.version}</span> : null}
          </div>
        </div>

        {/* View mode toggle */}
        <div className="flex gap-1 bg-warm-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("tree")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "tree"
                ? "bg-white shadow text-warm-900"
                : "text-warm-700 hover:text-warm-900"
            }`}
          >
            Tree
          </button>
          <button
            onClick={() => setViewMode("xml")}
            className={`px-3 py-1 text-sm rounded ${
              viewMode === "xml"
                ? "bg-white shadow text-warm-900"
                : "text-warm-700 hover:text-warm-900"
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
