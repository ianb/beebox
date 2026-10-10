/**
 * The courseware plugin's view for `concept-map` cards: the intro prose first,
 * then the graph (React Flow + dagre). A box activates it with a stub at
 * `src/views/concept-map.tsx` that re-exports this component as its default
 * and declares `rendersCardTypes = ["concept-map"]` with a `dependencies`
 * glob covering `**\/*.concept-map.card`.
 *
 * The card this view renders is the anchor card: the host sets `params.path`
 * to the card's own path and the stub's `dependencies` glob brings it into
 * `cards`. This module imports only `react`, `beebox/view-widgets`, the graph
 * libraries, and its own `view/` siblings, so it can be bundled for a box.
 */

import { useMemo } from "react";
import { Markdown, type ViewCard, type ViewProps } from "beebox/view-widgets";
import { parseConcepts } from "./view/concept-data.js";
import { ConceptGraph } from "./view/graph/ConceptGraph.js";

function ConceptMapView({ cards, params }: ViewProps) {
  const card = cards.find((c) => c.path === params["path"]);
  if (card === undefined) {
    // `params.path` comes from the URL; a stale link can name a card the
    // dependencies glob no longer selects.
    return <div className="bbx-cm-root"><p className="bbx-cm-empty">This concept-map card is not available.</p></div>;
  }
  return <ConceptMapCard card={card} />;
}

function ConceptMapCard({ card }: { card: ViewCard }) {
  // Memoized so the graph receives a stable `concepts` and doesn't re-layout on
  // every render (it re-runs dagre when the array identity changes).
  const concepts = useMemo(() => parseConcepts(card.frontmatter?.["concepts"]), [card]);
  const body = card.body ?? "";

  return (
    <div className="bbx-cm-root">
      {body.trim() !== "" ? <Markdown card={card}>{body}</Markdown> : null}
      {concepts.length === 0 ? (
        <p className="bbx-cm-empty">This concept-map has no concepts yet.</p>
      ) : (
        <ConceptGraph concepts={concepts} />
      )}
    </div>
  );
}

/** Named alias for the box stub to re-export beside the default. */
export const conceptMapView = ConceptMapView;

export default ConceptMapView;
