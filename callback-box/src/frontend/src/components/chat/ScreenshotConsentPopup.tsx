/**
 * Consent popup for an agent-initiated screenshot request (Track B fallback,
 * when the extension relay isn't available). "The agent wants to see this
 * screen" with Share / Decline. Requirements from the plan:
 *
 * - Share's onClick calls captureTabScreenshot() DIRECTLY (via `shareViaPopup`,
 *   whose first statement is the capture) so getDisplayMedia keeps the click's
 *   user activation.
 * - Decline — and Escape / click-away — post `{declined:true}`.
 * - The popup auto-dismisses at `expiresAt` and posts nothing (the server times
 *   out honestly).
 * - One request at a time: the parent renders this for the FIFO head only.
 *
 * Under `components/`, so it may use semantic color classes directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Row } from "../ui/Row";
import { Text } from "../ui/Text";
import {
  declineViaPopup,
  shareViaPopup,
  type ScreenshotIndicator,
  type ScreenshotRequest,
} from "./screenshot-request-handler";

export function ScreenshotConsentPopup({ request, onResolved }: {
  request: ScreenshotRequest;
  /** Called once — with an indicator on a successful share, or null on decline/dismiss/timeout. */
  onResolved: (indicator: ScreenshotIndicator | null) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Guard against a double-resolve: Share can race the auto-dismiss timer or an
  // Escape. Whoever fires first wins; later calls are dropped.
  const resolvedRef = useRef(false);
  const resolve = useCallback(
    (indicator: ScreenshotIndicator | null) => {
      if (resolvedRef.current) {
        // A late Share landed after the auto-dismiss timer / Escape already won:
        // the indicator it carries will never be rendered, so revoke its object
        // URL here rather than leak it (finding 3b — the discarded-late path).
        if (indicator !== null) URL.revokeObjectURL(indicator.thumbnailUrl);
        return;
      }
      resolvedRef.current = true;
      onResolved(indicator);
    },
    [onResolved],
  );

  // Auto-dismiss at the deadline — posts nothing; the server's own timeout is the
  // honest signal. An already-past / unparseable deadline collapses to 0.
  useEffect(() => {
    const remaining = Date.parse(request.expiresAt) - Date.now();
    const delay = Number.isNaN(remaining) ? 0 : Math.max(0, remaining);
    const timer = setTimeout(() => resolve(null), delay);
    return () => clearTimeout(timer);
  }, [request.expiresAt, resolve]);

  // Escape / click-away are a Decline: post declined, then resolve.
  const decline = useCallback(() => {
    void declineViaPopup(request);
    resolve(null);
  }, [request, resolve]);

  useEffect(() => {
    function handlePointer(e: MouseEvent) {
      if (cardRef.current !== null && e.target instanceof Node && !cardRef.current.contains(e.target)) {
        decline();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") decline();
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [decline]);

  // Once Share is clicked we unmount the dialog IMMEDIATELY, before the capture
  // grabs its frame — otherwise getDisplayMedia photographs this very dialog
  // ("The agent wants to see this screen" ends up in the screenshot). Setting
  // state here still keeps the click's user activation: `shareViaPopup`'s first
  // statement calls getDisplayMedia synchronously, before React flushes this
  // re-render, and the frame isn't grabbed until the picker resolves (seconds
  // later, by which time this overlay is gone).
  const [sharing, setSharing] = useState(false);
  const share = async (): Promise<void> => {
    setSharing(true);
    const indicator = await shareViaPopup(request);
    resolve(indicator);
  };

  // Dialog hidden while the capture is in flight (see `share`), so it never
  // appears in the frame. The request stays active until `share` resolves.
  if (sharing) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-6"
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot request"
    >
      <div ref={cardRef} className="w-full max-w-sm rounded-2xl bg-warm-50 border border-warm-200 p-6 shadow-lg">
        <Text as="h2" size="lg" weight="semibold">
          The agent wants to see this screen
        </Text>
        <Text as="p" size="sm" tone="muted" className="mt-2">
          Sharing sends a one-time screenshot of what you see now to the agent. You pick exactly what to
          share in the next browser dialog.
        </Text>
        <Row gap="sm" justify="end" className="mt-5">
          <Button id="cb-screenshot-consent-decline" intent="secondary" onClick={decline}>
            Decline
          </Button>
          <Button id="cb-screenshot-consent-share" intent="primary" onClick={share} loadingLabel="Sharing…">
            Share screenshot
          </Button>
        </Row>
      </div>
    </div>
  );
}
