/**
 * Dev-only route (/dev/capture-mode) hosting the capture-mode harness. Thin
 * wrapper so the harness UI lives under a components/ dir (exempt from the page
 * className restriction). See CaptureModeHarness for details.
 */

import { CaptureModeHarness } from "./components/CaptureModeHarness";

export function CaptureModePage() {
  return <CaptureModeHarness />;
}
