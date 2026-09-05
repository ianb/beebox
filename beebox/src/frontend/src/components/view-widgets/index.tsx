/**
 * Public card-aware view widgets.
 *
 * Registered on `window.__bbxViewWidgets` so the view compiler's
 * `beebox/view-widgets` browser shim can hand them to a dynamically
 * imported box view — exactly mirroring how `window.__bbxReact` exposes React.
 * Importing this module (side effect) installs the global; AgentViewRenderer does so
 * before it ever loads a view, so the shim's eager read always finds them.
 */

import { CardLink } from "./CardLink";
import { CardRef } from "./CardRef";

export type { CardLinkProps } from "./CardLink";
export type { CardRefProps } from "./CardRef";

declare global {
  interface Window {
    __bbxViewWidgets?: { CardLink: typeof CardLink; CardRef: typeof CardRef };
  }
}

if (typeof window !== "undefined" && !window.__bbxViewWidgets) {
  window.__bbxViewWidgets = { CardLink, CardRef };
}
