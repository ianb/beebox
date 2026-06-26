/**
 * Full-page wrapper for a view, rendered at /$boxSlug/views/$viewPath.
 *
 * File paths (containing "/" or a known extension) use FileView with the
 * renderer registry. Plain slugs fall back to ViewRenderer for legacy
 * agent-generated .tsx views.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { parseViewUrl } from "../lib/view-url";
import { useViewNavigate } from "../hooks/useViewNavigate";
import { FileView } from "../components/FileView";
import { ViewRenderer } from "../components/ViewRenderer";
import { Text } from "../components/ui/Text";

const FILE_EXTENSIONS = new Set([
  ".md", ".card", ".txt", ".json", ".xml", ".html", ".csv", ".tsv", ".yaml", ".yml",
  ".pdf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
]);

function looksLikeFilePath(value: string): boolean {
  if (value.includes("/")) return true;
  const dotIdx = value.lastIndexOf(".");
  if (dotIdx > 0 && FILE_EXTENSIONS.has(value.slice(dotIdx))) return true;
  return false;
}

export function ViewPage() {
  const { _splat: splat } = useParams({ strict: false });
  const handleNavigate = useViewNavigate();

  const parsed = useMemo(() => {
    if (!splat) return null;
    const qs = window.location.search;
    const raw = qs ? `${splat}${qs}` : splat;
    if (looksLikeFilePath(splat)) {
      return { type: "file" as const, target: parseViewUrl(raw) };
    }
    // Plain slug — legacy custom view
    const params: Record<string, string> = {};
    const search = new URLSearchParams(window.location.search);
    for (const [key, value] of search.entries()) {
      params[key] = value;
    }
    return { type: "slug" as const, slug: splat, params };
  }, [splat]);

  if (!parsed) {
    return <Text as="div" tone="muted" className="p-8">No view specified.</Text>;
  }

  return (
    <div className="p-4">
      {parsed.type === "file" ? (
        <FileView
          path={parsed.target.path}
          mode="page"
          rendererName={parsed.target.viewer}
          onNavigate={handleNavigate}
        />
      ) : (
        <ViewRenderer slug={parsed.slug} mode="page" params={parsed.params} />
      )}
    </div>
  );
}
