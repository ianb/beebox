/**
 * Browser-task card renderer — registers BrowserTaskView for `browser-task`
 * cards, so the card page shows the prompt, the record schema, the
 * submission form, and the inbox instead of the generic frontmatter table.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const browserTaskRenderer: RendererEntry = {
  selector: { type: "browser-task" },
  renderer: { name: "Browser task", Component: lazyComponent(() => import("../components/BrowserTaskView"), (m) => m.BrowserTaskView), priority: 100 },
};
