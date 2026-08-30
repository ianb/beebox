/**
 * Concept-map card renderer — registers ConceptMapView for `concept-map` cards.
 * The view (intro prose + graph) lives in components/; the graph itself is
 * code-split there so React Flow stays out of the main bundle.
 */

import { ConceptMapView } from "../components/concept-map/ConceptMapView";
import { registerFileType } from "./index";

registerFileType({ type: "concept-map" }, {
  renderer: { name: "Concept Map", Component: ConceptMapView, priority: 100 },
});
