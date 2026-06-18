/**
 * Extfile card renderer — registers ExtfileView for `extfile` cards.
 *
 * The view lives in components/ so its appearance classes sit next to the
 * rendering logic (same split as webpage/commentary).
 */

import { ExtfileView } from "../components/ExtfileView";
import { registerCardRenderer } from "./index";

registerCardRenderer("extfile", {
  name: "Extfile",
  Component: ExtfileView,
  priority: 100,
});
