/**
 * Webpage card renderer — registers WebpageView for `webpage` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as commentary/recipe).
 */

import { WebpageView } from "../components/WebpageView";
import type { RendererEntry } from "../file-type-registry";

export const webpageRenderer: RendererEntry = {
  selector: { type: "webpage" },
  renderer: { name: "Webpage", Component: WebpageView, priority: 100 },
};
