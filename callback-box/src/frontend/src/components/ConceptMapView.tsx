/**
 * Renderer for `concept-map` cards: the intro prose first, then the graph.
 *
 * The graph (React Flow + dagre) is code-split via `lazy`, so a card view that
 * isn't a concept-map never loads it. The body is rendered with the shared
 * Markdown component; an empty map (no concepts) shows a message instead of the
 * graph.
 */

import { Suspense, lazy, useMemo } from "react";
import type { RendererProps } from "../renderers/index";
import { parseConcepts } from "./concept-map/concept-data";
import { Markdown } from "./Markdown";
import { Text } from "./ui/Text";

const ConceptGraph = lazy(() => import("./concept-map/ConceptGraph"));

export function ConceptMapView({ data, onNavigate }: RendererProps) {
  // Memoized so the lazy graph receives a stable `concepts` and doesn't re-layout
  // on every render (it re-runs dagre when the array identity changes).
  const concepts = useMemo(() => parseConcepts((data.frontmatter ?? {})["concepts"]), [data.frontmatter]);
  const body = data.body ?? "";

  return (
    <div className="flex flex-col gap-4">
      {body.trim() !== "" ? (
        <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>
          {body}
        </Markdown>
      ) : null}
      {concepts.length === 0 ? (
        <Text tone="muted">This concept-map has no concepts yet.</Text>
      ) : (
        <Suspense fallback={<Text tone="muted">Loading graph…</Text>}>
          <ConceptGraph concepts={concepts} />
        </Suspense>
      )}
    </div>
  );
}
