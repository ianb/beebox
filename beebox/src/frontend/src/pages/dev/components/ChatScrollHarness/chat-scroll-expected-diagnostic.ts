import type { RunContext } from "./chat-scroll-sampler";

/** This fixture intentionally triggers Chromium's undelivered-resize diagnostic. */
const RESIZE_RACE_MESSAGE = "ResizeObserver loop completed with undelivered notifications.";

/** Consume one exact fixture diagnostic during the intentional resize race. */
export async function runExpectedResizeRace(ctx: RunContext, run: (arm: () => void) => Promise<void>): Promise<void> {
  let armed = false;
  let consumed = false;
  const onError = (event: ErrorEvent): void => {
    if (!armed || consumed || event.message !== RESIZE_RACE_MESSAGE) return;
    consumed = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.removeEventListener("error", onError, true);
    ctx.log("expected-browser-diagnostic", { step: "growTwiceInOnePass", message: RESIZE_RACE_MESSAGE });
  };
  // Capture runs before DebugLog's bubble listener, but only the exact known
  // diagnostic is stopped. Other errors continue through normal logging.
  window.addEventListener("error", onError, true);
  try {
    await run(() => { armed = true; });
  } finally {
    window.removeEventListener("error", onError, true);
  }
}
