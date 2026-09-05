/**
 * Extfile card renderer — registers ExtfileView for `extfile` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as webpage/commentary).
 */

import { ExtfileView } from "../components/ExtfileView";
import { registerFileType } from "./index";

registerFileType({ type: "extfile" }, {
  renderer: { name: "Extfile", Component: ExtfileView, priority: 100 },
});
