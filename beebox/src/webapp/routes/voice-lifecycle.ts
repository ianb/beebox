/**
 * Voice-recording GC sweep lifecycle (`docs/plans/resilient-voice-recording.md`,
 * Track 1) — the periodic timer wiring for `sweepVoiceSessions`, split out of
 * `capture.ts` to keep its route-registration function under the line budget.
 * Mirrors `capture.ts`'s `scheduleAbandonmentSweep`: awake-time cadence (never
 * wall time, so a macOS sleep can't mass-fire it), self-rearming, with a
 * cancel handle wired to server close.
 */

import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import { sweepVoiceSessions } from "../../core/voice-recording/sweep.js";

/** How much awake time between voice sweeps — same cadence as the capture abandonment sweep. */
const VOICE_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function scheduleVoiceSweep(opts: { boxRoot: string }): () => void {
  const { boxRoot } = opts;
  let timer: AwakeTimeout | null = null;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    const result = await sweepVoiceSessions({ boxRoot });
    if (result.deleted.length > 0) {
      console.warn(`[voice-recording] Sweep GC'd ${result.deleted.length} recording(s): ${result.deleted.join(", ")}`);
    }
    // `result.lateDeliveryPending` is a named hook: the late-delivery chunk
    // (Track 1's next chunk) re-probes these ids on this same tick rather
    // than adding a second timer.
  };

  const arm = (): void => {
    if (stopped) return;
    timer = startAwakeTimeout({
      timeoutMs: VOICE_SWEEP_INTERVAL_MS,
      onTimeout: () => {
        void runOnce()
          .catch((err: unknown) => {
            console.error(`[voice-recording] Sweep failed for box=${boxRoot}:`, err);
          })
          .finally(() => arm());
      },
    });
  };

  arm();
  return () => {
    stopped = true;
    timer?.stop();
  };
}
