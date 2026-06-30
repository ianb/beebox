/**
 * Public card-aware view widgets.
 *
 * Registered on `window.__cbViewWidgets` so the view compiler's
 * `callback-box/view-widgets` browser shim can hand them to a dynamically
 * imported box view — exactly mirroring how `window.__cbReact` exposes React.
 * Importing this module (side effect) installs the global; ViewRenderer does so
 * before it ever loads a view, so the shim's eager read always finds them.
 */

import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";

export { CardLink, CardRef };
export type { CardLinkProps } from "./CardLink";
export type { CardRefProps } from "./CardRef";

declare global {
  interface Window {
    __cbViewWidgets?: { CardLink: typeof CardLink; CardRef: typeof CardRef };
  }
}

if (typeof window !== "undefined" && !window.__cbViewWidgets) {
  window.__cbViewWidgets = { CardLink, CardRef };
}
