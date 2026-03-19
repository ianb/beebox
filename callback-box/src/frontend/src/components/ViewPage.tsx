/**
 * Full-page wrapper for a view, rendered at /$boxSlug/views/$slug.
 */

import { useParams } from "@tanstack/react-router";
import { ViewRenderer } from "./ViewRenderer";

export function ViewPage() {
  const { _splat: slug } = useParams({ strict: false });

  if (!slug) {
    return <div className="p-8 text-gray-500">No view specified.</div>;
  }

  return (
    <div className="p-4">
      <ViewRenderer slug={slug} mode="page" />
    </div>
  );
}
