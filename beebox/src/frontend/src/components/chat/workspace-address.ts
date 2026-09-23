/**
 * The `bbx-` addresses of a workspace tab and its panel.
 *
 * One module because the tab strip and the canvas each render one half of an
 * `aria-controls`/`aria-labelledby` pair and must spell the other's id exactly.
 *
 * A card path is not a control address — it carries slashes, dots and case —
 * and interpolating it raw (as this did, URL-encoded) minted ids the scan will
 * not report and `bin/browse` cannot act on, because the address grammar has no
 * room for a character a CSS selector would need escaped. `controlAddress`
 * encodes the path instead, so the tab keeps a distinct, stable address per
 * open document.
 */

import { controlAddress } from "@shared/control-address";

export function workspaceTabId(path: string): string {
  return controlAddress("bbx-workspace-tab", path);
}

export function workspacePanelId(path: string): string {
  return controlAddress("bbx-workspace-panel", path);
}
