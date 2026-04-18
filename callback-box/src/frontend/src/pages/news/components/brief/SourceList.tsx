/**
 * SourceList - Grouped source references (primary, supporting, mentioned).
 */

import type { SourceRef } from "./types";

export function SourceList({
  sources,
  onSourceClick,
}: {
  sources: SourceRef[];
  onSourceClick?: (path: string) => void;
}) {
  if (sources.length === 0) return null;

  const grouped = {
    primary: sources.filter((s) => s.usage === "primary"),
    supporting: sources.filter((s) => s.usage === "supporting"),
    mentioned: sources.filter((s) => s.usage === "mentioned" || !s.usage),
  };

  return (
    <div className="mt-8 pt-6 border-t border-warm-300">
      <h3 className="text-sm font-semibold text-warm-700 uppercase tracking-wide mb-3">
        Sources
      </h3>
      <div className="space-y-4">
        {grouped.primary.length > 0 && (
          <div>
            <p className="text-xs text-warm-600 mb-1">Primary</p>
            <ul className="space-y-1">
              {grouped.primary.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-primary hover:text-primary-dark hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {grouped.supporting.length > 0 && (
          <div>
            <p className="text-xs text-warm-600 mb-1">Supporting</p>
            <ul className="space-y-1">
              {grouped.supporting.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-primary hover:text-primary-dark hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {grouped.mentioned.length > 0 && (
          <div>
            <p className="text-xs text-warm-600 mb-1">Also referenced</p>
            <ul className="space-y-1">
              {grouped.mentioned.map((source, i) => (
                <li key={i}>
                  <button
                    onClick={() => onSourceClick?.(source.path)}
                    className="text-warm-700 hover:text-warm-800 hover:underline text-sm text-left"
                  >
                    {source.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
