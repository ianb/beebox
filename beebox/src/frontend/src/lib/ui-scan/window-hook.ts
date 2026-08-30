/**
 * The scan, reachable from outside the app: `window.__bbxUiScan()`.
 *
 * `bin/browse` calls this through agent-browser's `eval` to learn which of the
 * controls in an accessibility snapshot carry a `bbx-` address, so an automated
 * driver can act by id instead of by a positional ref that renumbers on every
 * re-render (browse/src/controls.ts). It is the same walk the box agent's
 * `bbx chat ui` dump uses, so the driver and the agent see one inventory.
 *
 * Read-only and content-free by construction (`data-bbx-scan="exclude"` prunes
 * user content from the walk), so exposing it unconditionally costs nothing
 * that a DevTools console could not already read.
 */

import { scanLiveDocument } from "./live-dom.js";
import type { ScanResult } from "./types.js";

declare global {
  interface Window {
    __bbxUiScan?: () => ScanResult;
  }
}

export function installUiScanHook(): void {
  window.__bbxUiScan = scanLiveDocument;
}
