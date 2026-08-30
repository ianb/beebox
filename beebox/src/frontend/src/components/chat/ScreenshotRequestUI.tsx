/**
 * The view for the screenshot-request controller ({@link useScreenshotRequests}):
 * the ephemeral "shared" indicator strip (in status-banner flow) plus the FIFO
 * consent popup (a fixed overlay). Composed into one element so the chat body
 * mounts the whole feature with a single tag.
 */

import { ScreenshotConsentPopup } from "./ScreenshotConsentPopup";
import { ScreenshotIndicatorStrip } from "./ScreenshotIndicatorStrip";
import type { ScreenshotRequestController } from "./screenshot-request-handler";

export function ScreenshotRequestUI({ controller }: { controller: ScreenshotRequestController }) {
  const { indicators, activeRequest } = controller;
  const handleDismissIndicator = controller.onDismissIndicator;
  const handleResolveActive = controller.onResolveActive;
  return (
    <>
      <ScreenshotIndicatorStrip indicators={indicators} onDismiss={handleDismissIndicator} />
      {activeRequest ? (
        <ScreenshotConsentPopup
          key={activeRequest.requestId}
          request={activeRequest}
          onResolved={handleResolveActive}
        />
      ) : null}
    </>
  );
}
