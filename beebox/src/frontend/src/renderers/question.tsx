/**
 * Question card renderer — registers the QuestionCardView component for
 * question cards, so a `/browse/<path>` deep link lands on an answerable
 * form (or the recorded answer) instead of the generic frontmatter table.
 */

import { QuestionCardView } from "../components/QuestionCardView";
import { registerFileType } from "./index";

registerFileType({ type: "question" }, {
  renderer: { name: "Question", Component: QuestionCardView, priority: 100 },
});
