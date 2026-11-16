/**
 * Tour card renderer — registers TourCard for `tour` cards, with a strip
 * rendering (`plan:conversation-strip`, Track B).
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const tourRenderer: RendererEntry = {
  selector: { type: "tour" },
  renderer: { name: "Tour", Component: lazyComponent(() => import("../components/TourCard/view"), (m) => m.TourCard), priority: 100, strip: true },
};
