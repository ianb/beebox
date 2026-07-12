/**
 * Pending capture bubble (Track 4).
 *
 * A server-derived counterpart to the queued-message pending bubble: while a
 * sealed capture works through preparation/delivery, the chat shows a dimmed
 * user-style bubble with a live caption ("preparing…" → "transcribing…" →
 * "queued…"), and a retry affordance if delivery failed. Unlike the client-only
 * `SessionEntry.pending` bubbles, this renders from the `capture.pendingSessions`
 * tRPC query so it survives reload / another tab, with `capture-status` bus
 * events refining the caption live. It disappears when the delivered `<capture>`
 * message lands (the staging session is cleaned up, so the query drops it).
 *
 * Pure caption/summary helpers are exported so the dev harness can drive every
 * state without a backend.
 */

import type { PendingCaptureCounts } from "@core/capture/pending.js";

/** Live refinement from a `capture-status` bus event (more granular than the query state). */
export type CaptureLiveStatus = "preparing" | "transcribing" | "delivered" | "failed";

/** One pending capture bubble's data — the query row plus any live status. */
export interface CaptureBubbleModel {
  id: string;
  /** Staging lifecycle state from the query (`sealed`/`preparing`/`delivering`/`failed:*`). */
  state: string;
  counts: PendingCaptureCounts;
  /** Latest `capture-status` event for this staging id, if one arrived this session. */
  liveStatus?: CaptureLiveStatus | undefined;
}

/** Whether a bubble is in a failed state (query state or live event). */
export function captureBubbleFailed(model: CaptureBubbleModel): boolean {
  return model.state.startsWith("failed:") || model.liveStatus === "failed";
}

/** The caption under the bubble. Live status wins over the coarser query state. */
export function captureBubbleCaption(model: CaptureBubbleModel): string {
  if (captureBubbleFailed(model)) return "failed — tap to retry";
  if (model.liveStatus === "transcribing") return "transcribing…";
  if (model.state === "delivering") return "queued…";
  return "preparing…";
}

/** The bubble body: a compact tally of the captured media. */
export function captureMediaSummary(counts: PendingCaptureCounts): string {
  const parts: string[] = [];
  if (counts.photos > 0) parts.push(`${String(counts.photos)} photo${counts.photos === 1 ? "" : "s"}`);
  if (counts.audioSegments > 0) parts.push(`${String(counts.audioSegments)} clip${counts.audioSegments === 1 ? "" : "s"}`);
  if (counts.files > 0) parts.push(`${String(counts.files)} file${counts.files === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(", ") : "capture";
}

function CameraIcon() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <circle cx="12" cy="13" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CaptureCaption({ caption, failed, onClick }: { caption: string; failed: boolean; onClick?: () => void }) {
  if (failed) {
    return (
      <button onClick={onClick} className="flex items-center gap-1.5 text-xs text-danger-dark hover:text-danger pr-2">
        <span className="inline-block w-2 h-2 rounded-full bg-danger" />
        {caption}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-warm-500 pr-2">
      <span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />
      {caption}
    </div>
  );
}

/**
 * Render one pending capture bubble. Failed captures render the caption as a
 * retry button (re-POSTs finalize, which the route re-fires from `failed:*`).
 */
export function CaptureBubbleView({ model, onRetry }: { model: CaptureBubbleModel; onRetry: (id: string) => void }) {
  const failed = captureBubbleFailed(model);
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="flex flex-col items-end gap-1">
        <div
          className="flex items-center gap-1.5 text-sm rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words opacity-60"
          title={failed ? "Capture delivery failed" : "Capture is being prepared…"}
        >
          <CameraIcon />
          <span>{captureMediaSummary(model.counts)}</span>
        </div>
        <CaptureCaption caption={captureBubbleCaption(model)} failed={failed} onClick={() => onRetry(model.id)} />
      </div>
    </div>
  );
}
