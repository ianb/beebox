import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const tabArrangementRenderer: RendererEntry = {
  selector: { type: "tab-arrangement" },
  renderer: { name: "Organizer", Component: lazyComponent(() => import("../components/TabArrangementView"), (m) => m.TabArrangementView), priority: 100 },
};
