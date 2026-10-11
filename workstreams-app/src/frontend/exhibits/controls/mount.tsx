// The control bar a raw index.html exhibit opts into (docs/exhibits.md,
// "Controls on a raw page"): Reply in the session and the comment panel,
// fixed to the bottom of the viewport, rendered in a shadow root so the
// page's styles and the bar's never touch. Loaded by ../controls.ts, which
// installs the React refresh preamble first.

import { createRoot } from "react-dom/client";

import { ControlBar } from "./ControlBar.js";
import { isStoreScope, scopeFromPath } from "./scope.js";
import { ExhibitErrorBoundary } from "../Container.js";
import sheet from "../styles.css?inline";

/** The bar's idle height: the bottom padding a page leaves for it. */
export const CONTROLS_HEIGHT_PX = 48;

// styles.css styles :root and body, neither of which exists inside a shadow
// tree, so the bar would inherit the page's font, colour, and colour scheme.
const HOST_BASELINE = ":host { display: block; font: 14px/1.4 system-ui, -apple-system, sans-serif; color: #292724; color-scheme: light; }";

/** Appends the bar to the page. Nothing to do on a path with no store exhibit. */
export function mountControls(): void {
  const scope = scopeFromPath(window.location.pathname);
  if (scope === null || !isStoreScope(scope)) {
    console.info(`exhibit controls: no bar on ${window.location.pathname}; it needs a /<workstream>/<exhibit>/ page`);
    return;
  }
  const host = document.createElement("div");
  host.dataset["exhibitControls"] = "";
  host.style.cssText = `position:fixed;inset:auto 0 0 0;z-index:2147483000;min-height:${String(CONTROLS_HEIGHT_PX)}px`;
  // A click inside the bar must not reach the comment panel's selection
  // listener on the body and be read as a selection on the page.
  host.addEventListener("mouseup", (event) => { event.stopPropagation(); });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${HOST_BASELINE}\n${sheet}`;
  const mount = document.createElement("div");
  shadow.append(style, mount);
  // On <html>, not <body>: a page script that replaces the body would take
  // the bar with it. The selection root is read when commenting turns on,
  // for the same reason.
  document.documentElement.append(host);
  const body = { get current(): HTMLElement { return document.body; } };
  createRoot(mount).render(
    <ExhibitErrorBoundary>
      <ControlBar scope={scope} contentRef={body} />
    </ExhibitErrorBoundary>,
  );
}
