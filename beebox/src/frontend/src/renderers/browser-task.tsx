/**
 * Browser-task card renderer — registers BrowserTaskView for `browser-task`
 * cards, so the card page shows the prompt, the record schema, the
 * submission form, and the inbox instead of the generic frontmatter table.
 */

import { BrowserTaskView } from "../components/BrowserTaskView";
import type { RendererEntry } from "../file-type-registry";

export const browserTaskRenderer: RendererEntry = {
  selector: { type: "browser-task" },
  renderer: { name: "Browser task", Component: BrowserTaskView, priority: 100 },
};
