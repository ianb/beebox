/**
 * Pending capture bubble (Track 4).
 *
 * A server-derived counterpart to the queued-message pending bubble: while a
 * sealed capture works through preparation/delivery, the chat shows a dimmed
 * user-style bubble with a live caption ("preparing…" → "transcribing…" →
 * "queued…"). Unlike the client-only `SessionEntry.pending` bubbles, this
 * renders from the `capture.pendingSessions` tRPC query so it survives reload /
 * another tab, with `capture-status` bus events refining the caption live.
 *
 * Every state the capture can be in gets a face here, because the ones that
 * didn't have one each cost the boxholder something (engineering principle
 * #13 — a control shows the state the system is in):
 *
 *  - **working** says which step and, past the patience window, how long it has
 *    been at it. Preparation runs about a minute; a silent minute reads as a
 *    failure, and the boxholder re-captured on that assumption.
 *  - **resolved** is a positive face held briefly in place before the row
 *    leaves. Delivery used to be rendered as the row simply vanishing, so
 *    success and "nothing happened" looked identical.
 *  - **failed** carries its age and two real verbs. A failure that only offered
 *    "tap to retry" sat unactionable in a chat for 16 days; past
 *    {@link ABANDONMENT_WINDOW_MS} — the same line the abandonment sweep draws
 *    when it decides a failure needs a human — discard becomes the emphasized
 *    answer rather than another retry.
 *
 * Pure caption/phase helpers are exported so the dev harness and doctests can
 * drive every state without a backend or a clock.
 */

import { useState } from "react";
import type { PendingCaptureCounts } from "@core/capture/pending.js";
import { ABANDONMENT_WINDOW_MS } from "@shared/capture-staleness";
import { formatAgo, formatElapsed } from "../../lib/relative-time";
import { useNow } from "../../lib/use-now";
import { Button } from "../ui/Button";

/** Live refinement from a `capture-status` bus event (more granular than the query state). */
export type CaptureLiveStatus = "preparing" | "transcribing" | "delivered" | "failed";

/** How a capture left: delivered to the chat, or discarded by the user. */
export type CaptureResolution = "delivered" | "discarded";

/** The face the bubble wears. */
export type CaptureBubblePhase = "working" | "resolved" | "failed-fresh" | "failed-aged";

/** One pending capture bubble's data — the query row plus any live status. */
export interface CaptureBubbleModel {
  id: string;
  /** Staging lifecycle state from the query (`sealed`/`preparing`/`delivering`/`failed:*`). */
  state: string;
  counts: PendingCaptureCounts;
  /** When capture started — how long a working capture has been waited on. */
  startedAt: string;
  /** When the session last changed — what a failed caption reports the age of. */
  lastActivityAt: string;
  /** Latest `capture-status` event for this staging id, if one arrived this session. */
  liveStatus?: CaptureLiveStatus | undefined;
  /** Set once the capture is done; the row shows this briefly, then leaves. */
  resolution?: CaptureResolution | undefined;
  /** A retry or discard that came back with an error, shown in place of the caption. */
  actionError?: string | undefined;
}

/** The two verbs a failed capture offers, carried down as one stable prop. */
export interface CaptureVerbs {
  /** Retry a failed capture by re-sealing it. */
  retry: (id: string) => Promise<void>;
  /** Discard a failed capture, deleting its staged media. */
  discard: (id: string) => Promise<void>;
}

/** How long a working capture may stay silent before its caption starts reporting age. */
const WORKING_PATIENCE_MS = 45_000;

/** How often the age captions re-render. Coarse — they're measured in minutes. */
const AGE_TICK_MS = 15_000;

/** Whether a bubble is in a failed state (query state or live event). */
function captureBubbleFailed(model: CaptureBubbleModel): boolean {
  return model.state.startsWith("failed:") || model.liveStatus === "failed";
}

/**
 * The age that matters for this face, in ms.
 *
 * For a working capture that is how long the user has been waiting, so it runs
 * from `startedAt`. For a failed one it is how long the failure has sat
 * unresolved, so it runs from `lastActivityAt` — the same field the abandonment
 * sweep ages against, and the only one that stays honest across a retry (a
 * three-week-old capture that failed again a minute ago must not read "failed 3
 * weeks ago").
 *
 * `null` before the clock is known (first frame) or when the timestamp is
 * unparseable — both fall back to un-aged text rather than inventing a duration.
 */
export function captureBubbleAgeMs(model: CaptureBubbleModel, nowMs: number): number | null {
  if (nowMs <= 0) return null;
  const from = Date.parse(captureBubbleFailed(model) ? model.lastActivityAt : model.startedAt);
  if (Number.isNaN(from)) return null;
  return Math.max(0, nowMs - from);
}

/** Which face the bubble wears. A failure ages into `failed-aged` at the sweep's line. */
export function captureBubblePhase(model: CaptureBubbleModel, ageMs: number | null): CaptureBubblePhase {
  if (model.resolution !== undefined) return "resolved";
  if (!captureBubbleFailed(model)) return "working";
  return ageMs !== null && ageMs >= ABANDONMENT_WINDOW_MS ? "failed-aged" : "failed-fresh";
}

/** Which preparation step a working capture is on. */
function workingStep(model: CaptureBubbleModel): string {
  if (model.liveStatus === "transcribing") return "transcribing";
  if (model.state === "delivering") return "queued";
  return "preparing";
}

/** The caption under the bubble. Live status wins over the coarser query state. */
export function captureBubbleCaption(model: CaptureBubbleModel, ageMs: number | null): string {
  if (model.actionError !== undefined) return model.actionError;
  if (model.resolution === "delivered") return "delivered";
  if (model.resolution === "discarded") return "discarded";
  if (captureBubbleFailed(model)) {
    return ageMs === null ? "failed" : `failed ${formatAgo(ageMs)}`;
  }
  const step = workingStep(model);
  if (ageMs === null || ageMs < WORKING_PATIENCE_MS) return `${step}…`;
  return `still ${step} — ${formatElapsed(ageMs)}`;
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

/** Dot colour and animation per phase — the caption's status light. */
const PHASE_DOT: Record<CaptureBubblePhase, string> = {
  working: "bg-accent animate-pulse",
  resolved: "bg-success",
  "failed-fresh": "bg-danger",
  "failed-aged": "bg-danger",
};

const PHASE_TEXT: Record<CaptureBubblePhase, string> = {
  working: "text-warm-500",
  resolved: "text-success-dark",
  "failed-fresh": "text-danger-dark",
  "failed-aged": "text-danger-dark",
};

function CaptureCaption({ caption, phase }: { caption: string; phase: CaptureBubblePhase }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs pr-2 ${PHASE_TEXT[phase]}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${PHASE_DOT[phase]}`} />
      {caption}
    </div>
  );
}

/**
 * The two verbs on a failed capture. Discard is emphasized once the capture is
 * aged, because that is the point at which the sweep has already concluded
 * retrying it on its own would just loop.
 *
 * Discard asks first — it deletes the staged photos and audio, which never
 * reached the chat and exist nowhere else, so a mis-tap is unrecoverable. The
 * confirmation is the row itself rather than a modal: the thing being discarded
 * stays on screen while the question is asked.
 */
function FailedActions(props: {
  summary: string;
  aged: boolean;
  onRetry: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="text-xs text-warm-600 pr-2">Discard {props.summary}? They never reached the chat.</div>
        <div className="flex gap-1.5">
          <Button size="sm" intent="destructive" onClick={props.onDiscard} loadingLabel="discarding…">Discard</Button>
          <Button size="sm" intent="ghost" onClick={() => setConfirming(false)}>Keep</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5">
      <Button size="sm" intent={props.aged ? "ghost" : "secondary"} onClick={props.onRetry} loadingLabel="retrying…">Retry</Button>
      <Button size="sm" intent={props.aged ? "destructive" : "ghost"} onClick={() => setConfirming(true)}>Discard</Button>
    </div>
  );
}

/**
 * Render one pending capture bubble. Retry re-POSTs finalize (which the route
 * re-fires from `failed:*`); discard deletes the staging session through the
 * guarded cancel route. Both hand back promises so the button wears its own
 * in-flight face — the previous control gave no sign it had registered a tap.
 */
export function CaptureBubbleView(props: {
  model: CaptureBubbleModel;
  onRetry: (id: string) => Promise<void>;
  onDiscard: (id: string) => Promise<void>;
  /** Fixed clock for the dev harness and tests; defaults to a live ticking one. */
  now?: number;
}) {
  const { model, onRetry, onDiscard } = props;
  const tickedNow = useNow(AGE_TICK_MS);
  const now = props.now ?? tickedNow;
  const ageMs = captureBubbleAgeMs(model, now);
  const phase = captureBubblePhase(model, ageMs);
  const failed = phase === "failed-fresh" || phase === "failed-aged";
  const summary = captureMediaSummary(model.counts);
  return (
    <div className="flex justify-end pl-12 sm:pl-24 py-1">
      <div className="flex flex-col items-end gap-1">
        <div
          className={`flex items-center gap-1.5 text-sm rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words ${phase === "resolved" ? "opacity-90" : "opacity-60"}`}
          title={failed ? "Capture delivery failed" : "Capture is being prepared…"}
        >
          <CameraIcon />
          <span>{summary}</span>
        </div>
        <CaptureCaption caption={captureBubbleCaption(model, ageMs)} phase={phase} />
        {failed ? (
          <FailedActions
            summary={summary}
            aged={phase === "failed-aged"}
            onRetry={() => onRetry(model.id)}
            onDiscard={() => onDiscard(model.id)}
          />
        ) : null}
      </div>
    </div>
  );
}
