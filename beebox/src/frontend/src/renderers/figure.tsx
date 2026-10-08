/**
 * Figure card renderer — registers FigureView for `figure` cards.
 *
 * The view itself lives in components/ so its appearance and the mount harness
 * sit next to the rendering logic.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const figureRenderer: RendererEntry = {
  selector: { type: "figure" },
  renderer: { name: "Figure", Component: lazyComponent(() => import("../components/FigureView/view"), (m) => m.FigureView), priority: 100 },
};
