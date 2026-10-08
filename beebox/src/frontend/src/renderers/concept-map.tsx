/**
 * Concept-map card renderer — registers ConceptMapView for `concept-map` cards.
 * The view (intro prose + graph) lives in components/; the graph itself is
 * code-split there so React Flow stays out of the main bundle.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const conceptMapRenderer: RendererEntry = {
  selector: { type: "concept-map" },
  renderer: { name: "Concept Map", Component: lazyComponent(() => import("../components/concept-map/ConceptMapView"), (m) => m.ConceptMapView), priority: 100 },
};
