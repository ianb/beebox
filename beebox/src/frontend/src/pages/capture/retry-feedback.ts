/**
 * What the capture overlay shows when the user retries failed uploads.
 *
 * Retry used to be a small underlined word that produced no visible reaction at
 * all: the failure line simply disappeared while the transfers ran, so the only
 * way to learn whether the tap registered was to wait and see whether the
 * failures came back. That is the same defect as a capture chip with no
 * delivered face (engineering principle #13) — a control that doesn't show the
 * state the system is in.
 *
 * The states are kept as a pure reducer so every face is reachable in a doctest
 * without a transport: tapping retry starts `retrying`, the batch settles into
 * `recovered` or `failed-again`, and `recovered` expires back to `idle` on its
 * own.
 */

import { useCallback, useEffect, useReducer } from "react";

/** The face the failure banner wears. */
export type RetryFeedback =
  | { phase: "idle" }
  | { phase: "retrying"; count: number }
  | { phase: "recovered" }
  | { phase: "failed-again"; count: number };

export type RetryFeedbackEvent =
  /** The user tapped Retry; `count` is how many transfers are being replayed. */
  | { type: "retry-tapped"; count: number }
  /** Every transfer has settled; `failed` is what is still failed afterwards. */
  | { type: "settled"; failed: number }
  /** The recovered notice has been shown long enough. */
  | { type: "expire" };

/** How long "all uploads recovered" stays up before the banner goes quiet. */
const RECOVERED_NOTICE_MS = 3_000;

export function nextRetryFeedback(state: RetryFeedback, event: RetryFeedbackEvent): RetryFeedback {
  switch (event.type) {
    case "retry-tapped":
      // A tap with nothing to replay changes nothing — showing "retrying 0"
      // would be the same lie in the other direction.
      return event.count > 0 ? { phase: "retrying", count: event.count } : state;
    case "settled":
      if (state.phase !== "retrying") return state;
      return event.failed > 0 ? { phase: "failed-again", count: event.failed } : { phase: "recovered" };
    case "expire":
      return state.phase === "recovered" ? { phase: "idle" } : state;
  }
}

/**
 * Drive {@link nextRetryFeedback} from the upload counts.
 *
 * The batch is "settled" when nothing is in flight any more; what is still
 * failed at that moment decides between the recovered and failed-again faces.
 * Both counts come from the upload bookkeeping, so this needs no hook into the
 * transport itself.
 */
export function useRetryFeedback(opts: {
  pendingUploads: number;
  totalFailed: number;
  retryFailedUploads: () => void;
}): { feedback: RetryFeedback; onRetryFailed: () => void } {
  const { pendingUploads, totalFailed, retryFailedUploads } = opts;
  const [feedback, dispatch] = useReducer(nextRetryFeedback, { phase: "idle" });

  const onRetryFailed = useCallback(() => {
    dispatch({ type: "retry-tapped", count: totalFailed });
    retryFailedUploads();
  }, [totalFailed, retryFailedUploads]);

  const retrying = feedback.phase === "retrying";
  useEffect(() => {
    if (retrying && pendingUploads === 0) dispatch({ type: "settled", failed: totalFailed });
  }, [retrying, pendingUploads, totalFailed]);

  const recovered = feedback.phase === "recovered";
  useEffect(() => {
    if (!recovered) return;
    const timer = setTimeout(() => dispatch({ type: "expire" }), RECOVERED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [recovered]);

  return { feedback, onRetryFailed };
}
