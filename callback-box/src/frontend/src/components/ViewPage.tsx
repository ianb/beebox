/**
 * Full-page wrapper for a view, rendered at /$boxSlug/views/$slug.
 *
 * Query parameters from the URL (e.g., ?path=/store/archive) are
 * forwarded to the view component as params.
 */

import { useMemo } from "react";
import { useParams } from "@tanstack/react-router";
import { ViewRenderer } from "./ViewRenderer";

export function ViewPage() {
  const { _splat: slug } = useParams({ strict: false });

  const params = useMemo(() => {
    const result: Record<string, string> = {};
    const search = new URLSearchParams(window.location.search);
    for (const [key, value] of search.entries()) {
      result[key] = value;
    }
    return result;
  }, []);

  if (!slug) {
    return <div className="p-8 text-gray-500">No view specified.</div>;
  }

  return (
    <div className="p-4">
      <ViewRenderer slug={slug} mode="page" params={params} />
    </div>
  );
}
