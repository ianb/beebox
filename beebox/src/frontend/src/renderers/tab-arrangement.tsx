import { TabArrangementView } from "../components/TabArrangementView";
import type { RendererEntry } from "../file-type-registry";

export const tabArrangementRenderer: RendererEntry = {
  selector: { type: "tab-arrangement" },
  renderer: { name: "Organizer", Component: TabArrangementView, priority: 100 },
};
