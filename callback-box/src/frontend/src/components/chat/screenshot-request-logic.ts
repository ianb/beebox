/**
 * Pure decisions behind the agent-initiated screenshot flow (Track B): exact
 * session matching, expiry, capture-outcome→answer mapping, and the FIFO +
 * indicators reducer. Split from `screenshot-request-handler.ts` (the React hook
 * + network/DOM side) so this half imports nothing browser-coupled and the
 * decisions are doctestable under the Node tier — same split as
 * `background-tasks.ts` (pure) vs `BackgroundTasks.tsx` (view).
 */

import type { CaptureOutcome } from "./screenshot-capture";

/** Physical viewport the browser captured, echoed to the agent alongside the PNG. */
export interface ScreenshotViewport {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/** A live screenshot request for this tab — the transient `screenshot-request` payload. */
export interface ScreenshotRequest {
  requestId: string;
  session: string;
  /** ISO deadline past which the popup auto-dismisses and a queued request is dropped. */
  expiresAt: string;
}

/**
 * An ephemeral "screenshot shared with the agent" confirmation shown on the
 * answering client only — local UI, never a transcript write (persistent
 * in-thread posting is cut from v1, see the plan's Visibility section).
 */
export interface ScreenshotIndicator {
  requestId: string;
  /** Object URL of the downscaled image actually uploaded — revoked when the row dismisses. */
  thumbnailUrl: string;
}

/**
 * Exact-session match. Deliberately NOT the `forSession` helper: its
 * null-on-either-side wildcard would let an idle `?session=new` tab answer an
 * established session's request (the plan calls this out explicitly).
 */
export function matchesRequestSession(reqSession: string, viewSession: string | null): boolean {
  return viewSession !== null && reqSession === viewSession;
}

/**
 * Whether a request is already past its deadline. The comparison is loose on
 * purpose — `expiresAt` is a server hint against a possibly-skewed client clock,
 * so an unparseable value is treated as not-expired rather than dropped.
 */
export function isRequestExpired(expiresAt: string, nowMs: number): boolean {
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return false;
  return nowMs > deadline;
}

/** What to send back for a given capture outcome — the pure, tested decision. */
export type ScreenshotAnswerPlan =
  | { kind: "upload"; blob: Blob; viewport: ScreenshotViewport }
  | { kind: "declined" }
  | { kind: "failed"; reason: string };

/**
 * Map a {@link CaptureOutcome} to the answer to post. `unsupported` (mobile
 * Safari / insecure context) becomes the `unsupported-client` failure the plan
 * names; every other degraded path stays named, never a silent blank.
 */
export function captureOutcomeToAnswer(outcome: CaptureOutcome): ScreenshotAnswerPlan {
  switch (outcome.kind) {
    case "image":
      return { kind: "upload", blob: outcome.blob, viewport: outcome.viewport };
    case "declined":
      return { kind: "declined" };
    case "unsupported":
      return { kind: "failed", reason: "unsupported-client" };
    case "error":
      return { kind: "failed", reason: outcome.message };
  }
}

export interface ScreenshotState {
  /** FIFO of requests awaiting a consent popup; the head is the active popup. */
  queue: ScreenshotRequest[];
  /** Ephemeral "shared" confirmation rows, on this client only. */
  indicators: ScreenshotIndicator[];
}

export type ScreenshotAction =
  | { type: "enqueue"; request: ScreenshotRequest }
  | { type: "resolveHead"; indicator: ScreenshotIndicator | null }
  | { type: "addIndicator"; indicator: ScreenshotIndicator }
  | { type: "dismissIndicator"; requestId: string };

/**
 * The FIFO + indicators reducer. `enqueue` dedupes by requestId so a
 * multi-delivered event never stacks two popups; `resolveHead` pops the active
 * request (optionally adding its indicator); `addIndicator` is the relay path
 * that answered without ever queuing a popup; `dismissIndicator` ages a row out.
 */
export function screenshotReducer(state: ScreenshotState, action: ScreenshotAction): ScreenshotState {
  switch (action.type) {
    case "enqueue":
      if (state.queue.some((r) => r.requestId === action.request.requestId)) return state;
      return { ...state, queue: [...state.queue, action.request] };
    case "resolveHead": {
      const [, ...rest] = state.queue;
      const indicators = action.indicator
        ? [...state.indicators, action.indicator]
        : state.indicators;
      return { queue: rest, indicators };
    }
    case "addIndicator":
      return { ...state, indicators: [...state.indicators, action.indicator] };
    case "dismissIndicator":
      return {
        ...state,
        indicators: state.indicators.filter((i) => i.requestId !== action.requestId),
      };
  }
}
