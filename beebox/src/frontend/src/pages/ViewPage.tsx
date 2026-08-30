/**
 * Full-page wrapper for a file/card view, rendered at /$boxSlug/views/$viewPath.
 *
 * The splat is always a box path. FileView picks the renderer from the registry
 * (including a card type's own `rendersCardTypes` view, injected as a
 * card-attached renderer); `?view=` selects a specific one and other params
 * pass through to it. There is no card-less "standalone view" — every view is
 * attached to a card.
 */

import { useMemo } from "react";
import { useParams, useLocation } from "@tanstack/react-router";
import { parseViewUrl } from "../lib/view-url";
import { useViewNavigate } from "../hooks/useViewNavigate";
import { FileView } from "../components/FileView";
import { Text } from "../components/ui/Text";

export function ViewPage() {
  const { _splat: splat } = useParams({ strict: false });
  const location = useLocation();
  const handleNavigate = useViewNavigate();

  // Key on the query string too: navigating `?view=A` -> `?view=B` at the same
  // path must recompute the viewer/params, not reuse a splat-only memo.
  const target = useMemo(() => {
    if (!splat) return null;
    const qs = location.searchStr;
    return parseViewUrl(qs ? `${splat}${qs}` : splat);
  }, [splat, location.searchStr]);

  if (!target) {
    return <Text as="div" tone="muted" className="p-8">No view specified.</Text>;
  }

  return (
    <div className="p-4">
      <FileView
        path={target.path}
        mode="page"
        rendererName={target.viewer}
        params={target.params}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
