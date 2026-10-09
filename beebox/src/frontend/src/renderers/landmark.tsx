/**
 * Landmark card renderer — a landmark card renders as the place page
 * (`components/PlaceView/view.tsx`), wherever it is opened.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const landmarkRenderer: RendererEntry = {
  selector: { type: "landmark" },
  renderer: { name: "Place", Component: lazyComponent(() => import("../components/PlaceView/view"), (m) => m.PlaceView), priority: 100 },
};
