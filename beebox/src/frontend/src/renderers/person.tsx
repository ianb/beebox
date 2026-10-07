/**
 * Person card renderer — registers the PersonView front for person cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic.
 */

import { PersonView } from "../components/PersonView/view";
import type { RendererEntry } from "../file-type-registry";

export const personRenderer: RendererEntry = {
  selector: { type: "person" },
  renderer: { name: "Person", Component: PersonView, priority: 100 },
};
