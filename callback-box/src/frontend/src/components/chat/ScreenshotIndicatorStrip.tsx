/**
 * Ephemeral "screenshot shared with the agent" rows, on the answering client
 * only (the plan's Visibility section — NOT a transcript write). Rendered in the
 * status-banner area above the composer, mirroring the background-task strip, so
 * the scroll controller's ResizeObserver already accounts for the height change
 * (chat CLAUDE.md: below-list chrome resizes the scroller — no scroll effect is
 * added here). Each row self-dismisses after a few seconds, revoking its
 * thumbnail object URL as it goes.
 *
 * Under `components/`, so it may use semantic color classes directly.
 */

import { useEffect } from "react";
import { Image } from "../ui/Image";
import { Text } from "../ui/Text";
import type { ScreenshotIndicator } from "./screenshot-request-handler";

/** How long a "shared" row lingers before it ages out. */
const INDICATOR_TTL_MS = 6_000;

function IndicatorRow({ indicator, onDismiss }: {
  indicator: ScreenshotIndicator;
  onDismiss: (requestId: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      URL.revokeObjectURL(indicator.thumbnailUrl);
      onDismiss(indicator.requestId);
    }, INDICATOR_TTL_MS);
    return () => clearTimeout(timer);
  }, [indicator.requestId, indicator.thumbnailUrl, onDismiss]);

  return (
    <div className="flex items-center gap-2 text-xs text-warm-600 bg-warm-50 border border-warm-200 rounded-full px-3 py-1">
      <span aria-hidden="true">📸</span>
      <Text size="xs" tone="subtle">
        screenshot shared with the agent
      </Text>
      <Image
        src={indicator.thumbnailUrl}
        alt="Shared screenshot"
        size="thumb"
        bordered
        className="ml-auto w-8 h-8 rounded"
      />
    </div>
  );
}

export function ScreenshotIndicatorStrip({ indicators, onDismiss }: {
  indicators: ScreenshotIndicator[];
  onDismiss: (requestId: string) => void;
}) {
  if (indicators.length === 0) return null;
  return (
    <div className="mx-3 sm:mx-6 mb-1 flex flex-col gap-1" aria-label="Shared screenshots">
      {indicators.map((indicator) => (
        <IndicatorRow key={indicator.requestId} indicator={indicator} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
