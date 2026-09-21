/**
 * The scan, reachable from outside the app: `window.__bbxUiScan()`.
 *
 * `bin/browse` calls this through agent-browser's `eval` to learn which of the
 * controls in an accessibility snapshot carry a `bbx-` address, so an automated
 * driver can act by id instead of by a positional ref that renumbers on every
 * re-render (browse/src/controls.ts). It is the same walk the box agent's
 * `bbx chat ui` dump uses, over a wider scope.
 *
 * It answers for the whole document, card contents included, which is what a
 * driver needs: a control the walk skipped is one the snapshot prints with no
 * id and `bin/browse` cannot act on. Read-only, and it reports what is already
 * in the DOM, so exposing it unconditionally costs nothing a DevTools console
 * could not read. The narrowed `chrome` scope belongs to the `bbx chat ui`
 * dump, which calls `scanLiveDocument` directly.
 */

import { scanLiveDocument } from "./live-dom.js";
import type { ScanResult } from "./types.js";

declare global {
  interface Window {
    __bbxUiScan?: () => ScanResult;
  }
}

export function installUiScanHook(): void {
  window.__bbxUiScan = () => scanLiveDocument("document");
}
