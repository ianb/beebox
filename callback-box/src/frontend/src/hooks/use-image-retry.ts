import { useEffect, useReducer } from "react";

const RETRY_DELAYS_MS = [500, 1_500, 3_000, 5_000] as const;

type RetryState =
  | { phase: "waiting"; attempt: number; retryAt: number }
  | { phase: "loading" | "loaded" | "failed"; attempt: number };

// Chat markdown can remount an image while text streams. Keep retry progress
// outside the component so a remount cannot reset the bounded request budget.
const retryStates = new Map<string, RetryState>();

function appendRetryToken(url: string, attempt: number): string {
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const separator = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${separator}imageRetry=${attempt}${hash}`;
}

export interface RetryingImageSrc {
  displaySrc: string;
  failed: boolean;
  handleError: () => void;
  handleLoad: () => void;
}

/**
 * Retry one image URL on a short, bounded backoff. State changes are local to
 * the Image using this hook; chat containers do not subscribe or re-render.
 */
export function useImageRetry(src: string, enabled: boolean): RetryingImageSrc {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const state = enabled ? retryStates.get(src) : undefined;

  useEffect(() => {
    if (!enabled || state?.phase !== "waiting") return;

    const waitingState = state;
    const timeout = window.setTimeout(() => {
      if (retryStates.get(src) === waitingState) {
        retryStates.set(src, { phase: "loading", attempt: waitingState.attempt + 1 });
      }
      rerender();
    }, Math.max(0, waitingState.retryAt - Date.now()));

    return () => window.clearTimeout(timeout);
  }, [enabled, src, state]);

  const handleError = () => {
    if (!enabled) return;

    const current = retryStates.get(src);
    if (current?.phase === "waiting" || current?.phase === "failed") {
      rerender();
      return;
    }

    const attempt = current?.attempt ?? 0;
    const delay = RETRY_DELAYS_MS[attempt];
    retryStates.set(
      src,
      delay === undefined
        ? { phase: "failed", attempt }
        : { phase: "waiting", attempt, retryAt: Date.now() + delay },
    );
    rerender();
  };

  const handleLoad = () => {
    if (!enabled) return;
    const current = retryStates.get(src);
    if (current?.phase === "loading") {
      retryStates.set(src, { phase: "loaded", attempt: current.attempt });
    }
  };

  const attempt = state?.attempt ?? 0;
  return {
    displaySrc: attempt === 0 ? src : appendRetryToken(src, attempt),
    failed: state?.phase === "waiting" || state?.phase === "failed",
    handleError,
    handleLoad,
  };
}
