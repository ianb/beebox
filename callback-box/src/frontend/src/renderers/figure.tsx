/**
 * Figure card renderer — registers FigureView for `figure` cards.
 *
 * The view itself lives in components/ so its appearance and the mount harness
 * sit next to the rendering logic.
 */

import { FigureView } from "../components/FigureView";
import { registerCardRenderer } from "./index";

registerCardRenderer("figure", {
  name: "Figure",
  Component: FigureView,
  priority: 100,
});
