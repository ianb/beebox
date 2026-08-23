/**
 * "Send screenshot…" entry for the composer's Add menu. Clicking it does a
 * Sentry-style one-frame getDisplayMedia grab of what the user currently sees
 * ({@link captureTabScreenshot}) and feeds the PNG into the same attachment
 * pipeline pasted images use — so it lands as a `[imageN]` token, downscaled by
 * the shared 1920px path, no extra resize here. It routes like any other added
 * file (`file-routing.ts`): with the composer's inline photos already at the
 * limit, the grab joins a bulk batch instead of inlining.
 *
 * Self-contained like ShareLocationMenuItem: it feature-detects (renders
 * nothing where getDisplayMedia is unavailable, e.g. mobile) and owns its own
 * outcome handling. A picker the user dismisses is silent; a real failure
 * raises a toast — this flow hands off to a native picker, so a swallowed
 * failure (unlike the paste path's console-only log) would leave the user with
 * no signal at all.
 */

import { MenuItem } from "../ui/dropdown-menu-item";
import { toastError } from "../ui/toast-store";
import { captureTabScreenshot, isScreenshotSupported } from "./screenshot-capture";
import type { AddFiles } from "./InteractiveChat-attachments";

function screenshotFilename(): string {
  return `screenshot-${Date.now()}.png`;
}

async function runScreenshotCapture(addFiles: AddFiles): Promise<void> {
  const outcome = await captureTabScreenshot();
  switch (outcome.kind) {
    case "image": {
      const file = new File([outcome.blob], screenshotFilename(), { type: "image/png" });
      // A failed encode is surfaced by `addFiles` itself now, and a `batch`
      // outcome is a success (the grab went to the bulk-upload overlay), so
      // there is nothing left for this caller to check.
      await addFiles([file]);
      break;
    }
    case "declined":
      // The user dismissed the picker — a deliberate "no", nothing to surface.
      break;
    case "unsupported":
      toastError("Screenshots aren't supported in this browser.");
      break;
    case "error":
      toastError("The screenshot couldn't be captured.", { cause: outcome.message });
      break;
  }
}

export function ScreenshotMenuItem({ addFiles }: { addFiles: AddFiles }) {
  // Hidden where a capture would resolve `unsupported` (no getDisplayMedia).
  if (!isScreenshotSupported()) return null;
  return (
    // captureTabScreenshot calls getDisplayMedia synchronously before its first
    // await, so this click still counts as the required user gesture.
    <MenuItem onClick={() => void runScreenshotCapture(addFiles)}>
      Send screenshot…
    </MenuItem>
  );
}
