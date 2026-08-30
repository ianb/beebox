/**
 * Webpage card renderer — registers WebpageView for `webpage` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as commentary/recipe).
 */

import { WebpageView } from "../components/WebpageView";
import { registerFileType } from "./index";

registerFileType({ type: "webpage" }, {
  renderer: { name: "Webpage", Component: WebpageView, priority: 100 },
});
