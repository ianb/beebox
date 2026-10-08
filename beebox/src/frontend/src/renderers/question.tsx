/**
 * Question card renderer — registers the QuestionCardView component for
 * question cards, so a `/browse/<path>` deep link lands on an answerable
 * form (or the recorded answer) instead of the generic frontmatter table.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const questionRenderer: RendererEntry = {
  selector: { type: "question" },
  renderer: { name: "Question", Component: lazyComponent(() => import("../components/QuestionCardView"), (m) => m.QuestionCardView), priority: 100 },
};
