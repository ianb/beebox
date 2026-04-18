/**
 * PrintBriefView - Print-friendly rendering of a news brief.
 *
 * Mounted at /:boxSlug/print/<splat>. Handles routing/params, fetches
 * the brief, and delegates the actual print layout (which uses the
 * `print-*` custom CSS classes in index.css) to PrintBriefRenderer.
 */

import { useState } from "react";
import { useParams } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";
import { Text } from "../../components/ui/Text";
import type { NewsBriefData } from "./components/brief/types";
import { PrintBriefRenderer } from "./components/brief/PrintBriefRenderer";

export function PrintBriefView() {
  const { boxSlug, _splat: briefPath } = useParams({ strict: false });
  const [largePrint, setLargePrint] = useState(
    new URLSearchParams(window.location.search).get("large") === "1"
  );

  const briefQuery = trpc.briefs.get.useQuery(
    { path: briefPath! },
    { enabled: !!briefPath }
  );

  const brief = briefQuery.data?.brief as NewsBriefData | undefined;

  if (!briefPath) return <Text as="div" tone="subtle" className="p-4">No brief path</Text>;
  if (briefQuery.isLoading) return <Text as="div" tone="subtle" className="p-4">Loading...</Text>;
  if (briefQuery.error) return <Text as="div" tone="danger" className="p-4">Error: {briefQuery.error.message}</Text>;
  if (!brief) return null;

  return (
    <PrintBriefRenderer
      brief={brief}
      largePrint={largePrint}
      onToggleLargePrint={() => setLargePrint(!largePrint)}
      interactiveUrl={`/${boxSlug}/news/${briefPath}`}
    />
  );
}
