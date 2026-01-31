/**
 * View for displaying a card's content.
 */

import { useEffect, useState, useMemo } from "react";
import { getCard, type CardResponse } from "../api";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import "highlight.js/styles/github.css";

// Register XML language
hljs.registerLanguage("xml", xml);

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
}

export function CardView({ path }: CardViewProps) {
  const [card, setCard] = useState<CardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div className="mb-4">
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

      <HighlightedXml xml={card.xml} />
    </div>
  );
}
