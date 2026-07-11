/**
 * Browser side of an agent-initiated `cb chat screenshot` (Track B).
 *
 * The agent runs the CLI; the server broadcasts a transient `screenshot-request`
 * bus event carrying the target chat session and an `expiresAt` deadline. The
 * tab holding *exactly* that session acks immediately (closing the server's
 * `no-client` window), then answers with a PNG — captured either via the clerk
 * extension relay (Track C, {@link captureViaRelay} in `screenshot-relay.ts`) or,
 * as the fallback, a consent popup gating {@link captureTabScreenshot} (Track A).
 *
 * This module owns the orchestration and the small FIFO state behind the popup
 * queue + the ephemeral "shared with the agent" indicator rows; the popup and
 * indicator components (`ScreenshotConsentPopup.tsx`) are the view. Pure
 * decisions (exact-session match, expiry, outcome→answer mapping, queue reducer)
 * are exported for the doctest; the DOM capture/upload can't run under Node.
 */

import { useCallback, useEffect, useReducer } from "react";
import { getApiBase } from "../../api-core";
import { base64ToBlob, processImageBlob } from "../../lib/image-paste";
import { captureTabScreenshot, type CaptureOutcome } from "./screenshot-capture";
import { captureViaRelay, startRelayProbe } from "./screenshot-relay";
import {
  captureOutcomeToAnswer,
  isRequestExpired,
  matchesRequestSession,
  screenshotReducer,
  type ScreenshotAction,
  type ScreenshotIndicator,
  type ScreenshotRequest,
  type ScreenshotViewport,
} from "./screenshot-request-logic";

export type {
  ScreenshotIndicator,
  ScreenshotRequest,
  ScreenshotViewport,
} from "./screenshot-request-logic";

/** How the upload was produced — the agent learns which path it took. */
type Fidelity = "extension" | "displaymedia";

function answerUrl(requestId: string): string {
  return `${getApiBase()}/chat/screenshot/${encodeURIComponent(requestId)}`;
}

/**
 * POST a JSON answer (ack / declined / failed). A 404 is the normal multi-tab
 * or settled-request outcome (another tab won, or the CLI aborted) — quiet.
 * Never rejects: logs and returns so callers can fire-and-forget.
 */
async function postJson(requestId: string, { body, label }: { body: object; label: string }): Promise<void> {
  try {
    const res = await fetch(answerUrl(requestId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      console.warn(`[screenshot] ${label} rejected: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[screenshot] ${label} failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Ack that this tab saw and matched the request — closes the server's `no-client` window. */
export function postAck(requestId: string): Promise<void> {
  return postJson(requestId, { body: { ack: true }, label: "ack" });
}

/** Multipart-upload the PNG with its fidelity + viewport. Never rejects (logs and returns). */
async function uploadScreenshot(
  requestId: string,
  opts: { blob: Blob; fidelity: Fidelity; viewport: ScreenshotViewport },
): Promise<void> {
  const form = new FormData();
  form.append("file", opts.blob, `${requestId}.png`);
  form.append("fidelity", opts.fidelity);
  form.append("viewport", JSON.stringify(opts.viewport));
  try {
    const res = await fetch(answerUrl(requestId), { method: "POST", body: form });
    if (!res.ok && res.status !== 404) {
      console.warn(`[screenshot] upload rejected: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[screenshot] upload failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Answer a request with a capture outcome: post declined/failed, or downscale
 * the image through the shared attachment pipeline ({@link processImageBlob},
 * 1920px longest side) and upload it. Returns the indicator to show on success,
 * else null. Never rejects — a mid-pipeline failure posts `failed` and returns
 * null so the agent hears a reason.
 */
async function answerWithCapture(
  request: ScreenshotRequest,
  { outcome, fidelity }: { outcome: CaptureOutcome; fidelity: Fidelity },
): Promise<ScreenshotIndicator | null> {
  const plan = captureOutcomeToAnswer(outcome);
  switch (plan.kind) {
    case "declined":
      await postJson(request.requestId, { body: { declined: true }, label: "decline" });
      return null;
    case "failed":
      await postJson(request.requestId, { body: { failed: plan.reason }, label: "failure" });
      return null;
    case "upload":
      try {
        // Reuse the pasted-image pipeline's downscale. It returns a
        // ProcessedImage (base64 + a preview objectUrl), not a Blob, so
        // reconstruct the upload Blob from its base64 and reuse the objectUrl as
        // the indicator thumbnail (one downscale pipeline — principle #8).
        const processed = await processImageBlob(plan.blob);
        const blob = base64ToBlob(processed.dataBase64, processed.mimeType);
        await uploadScreenshot(request.requestId, { blob, fidelity, viewport: plan.viewport });
        return { requestId: request.requestId, thumbnailUrl: processed.objectUrl };
      } catch (e) {
        await postJson(request.requestId, {
          body: { failed: e instanceof Error ? e.message : String(e) },
          label: "failure",
        });
        return null;
      }
  }
}

/** Capture the outcome for the consent popup's Share button (user-gesture path). */
export async function shareViaPopup(request: ScreenshotRequest): Promise<ScreenshotIndicator | null> {
  // captureTabScreenshot() must be the first statement so getDisplayMedia runs
  // synchronously under the click's user activation before any await.
  const outcome = await captureTabScreenshot();
  return answerWithCapture(request, { outcome, fidelity: "displaymedia" });
}

/** Post the user's Decline for the consent popup (and Escape / click-away). */
export function declineViaPopup(request: ScreenshotRequest): Promise<void> {
  return postJson(request.requestId, { body: { declined: true }, label: "decline" });
}

/**
 * On a matched request: ack immediately (fire-and-forget), prefer the extension
 * relay, else queue a consent popup. Kept out of the hook body so the async flow
 * is legible; dispatch identity from useReducer is stable across renders.
 */
async function handleMatchedRequest(
  request: ScreenshotRequest,
  dispatch: (action: ScreenshotAction) => void,
): Promise<void> {
  void postAck(request.requestId);
  const relayOutcome = await captureViaRelay();
  if (relayOutcome !== null) {
    const indicator = await answerWithCapture(request, { outcome: relayOutcome, fidelity: "extension" });
    if (indicator) dispatch({ type: "addIndicator", indicator });
    return;
  }
  dispatch({ type: "enqueue", request });
}

export interface ScreenshotRequestController {
  /** The request whose consent popup is currently showing (FIFO head), or null. */
  activeRequest: ScreenshotRequest | null;
  /** Ephemeral shared-with-the-agent rows for the status strip. */
  indicators: ScreenshotIndicator[];
  /** WS entry point: dispatched from `useChatWs` on a `screenshot-request` event. */
  onScreenshotRequest: (request: ScreenshotRequest) => void;
  /** The active popup resolved (shared with an indicator, or declined/dismissed with null). */
  onResolveActive: (indicator: ScreenshotIndicator | null) => void;
  /** An indicator row aged out and should be removed. */
  onDismissIndicator: (requestId: string) => void;
}

/**
 * Hold the screenshot-request queue + indicators for one chat view. Low-frequency
 * (a request arrives, a popup shows/dismisses), so plain reducer state — like
 * `useBackgroundTasks` — not the input-store's external store: it never
 * re-renders per keystroke, and the companion view pane isn't in its subtree.
 */
export function useScreenshotRequests(sessionId: string | null): ScreenshotRequestController {
  const [state, dispatch] = useReducer(screenshotReducer, { queue: [], indicators: [] });

  // Probe for the clerk relay once at mount so an agent-initiated capture pays no
  // handshake latency. Presence is cached module-level in `screenshot-relay.ts`
  // (not React state — the chat scroll/store invariants forbid new root state).
  useEffect(() => {
    startRelayProbe();
  }, []);

  const onScreenshotRequest = useCallback(
    (request: ScreenshotRequest) => {
      if (!matchesRequestSession(request.session, sessionId)) return;
      if (isRequestExpired(request.expiresAt, Date.now())) return;
      void handleMatchedRequest(request, dispatch).catch((e) => {
        console.warn(`[screenshot] request handling failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    },
    [sessionId],
  );

  const onResolveActive = useCallback((indicator: ScreenshotIndicator | null) => {
    dispatch({ type: "resolveHead", indicator });
  }, []);

  const onDismissIndicator = useCallback((requestId: string) => {
    dispatch({ type: "dismissIndicator", requestId });
  }, []);

  return {
    activeRequest: state.queue[0] ?? null,
    indicators: state.indicators,
    onScreenshotRequest,
    onResolveActive,
    onDismissIndicator,
  };
}
