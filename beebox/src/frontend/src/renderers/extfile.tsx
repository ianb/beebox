/**
 * Extfile card renderer — registers ExtfileView for `extfile` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as webpage/commentary).
 */

import { ExtfileView } from "../components/ExtfileView/view";
import type { RendererEntry } from "../file-type-registry";

export const extfileRenderer: RendererEntry = {
  selector: { type: "extfile" },
  renderer: { name: "Extfile", Component: ExtfileView, priority: 100 },
};
