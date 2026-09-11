/**
 * Voice-recording GC sweep lifecycle (`docs/plans/resilient-voice-recording.md`,
 * Track 1) — the periodic timer wiring for `sweepVoiceSessions`, split out of
 * `capture.ts` to keep its route-registration function under the line budget.
 * Mirrors `capture.ts`'s `scheduleAbandonmentSweep`: awake-time cadence (never
 * wall time, so a macOS sleep can't mass-fire it), self-rearming, with a
 * cancel handle wired to server close.
 */

import { startAwakeTimeout, type AwakeTimeout } from "../../lib/awake-timeout.js";
import type { EventBus } from "../../core/event-bus.js";
import type { ChatSession } from "../../core/chat/session/index.js";
import type { ChatSessionRegistry } from "../../core/chat/session/registry.js";
import { sweepVoiceSessions } from "../../core/voice-recording/sweep.js";
import { attemptLateDelivery } from "../../core/voice-recording/deliver-late.js";

/** How much awake time between voice sweeps — same cadence as the capture abandonment sweep. */
const VOICE_SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function scheduleVoiceSweep(opts: {
  boxRoot: string;
  eventBus: EventBus;
  registry: ChatSessionRegistry;
  wireSession?: ((session: ChatSession) => void) | undefined;
}): () => void {
  const { boxRoot, eventBus, registry, wireSession } = opts;
  let timer: AwakeTimeout | null = null;
  let stopped = false;

  const runOnce = async (): Promise<void> => {
    const result = await sweepVoiceSessions({ boxRoot });
    if (result.deleted.length > 0) {
      console.warn(`[voice-recording] Sweep GC'd ${result.deleted.length} recording(s): ${result.deleted.join(", ")}`);
    }
    // Re-probe every recording stuck at `late`/`delivering` this tick —
    // `attemptLateDelivery` is a no-op unless there's real progress to make
    // (the original just landed, the correction just landed, or the target
    // session just freed up), so firing it unconditionally here is safe.
    await Promise.allSettled(result.lateDeliveryPending.map(async (id) => {
      try {
        await attemptLateDelivery({ boxRoot, id, eventBus, registry, wireSession });
      } catch (error) {
        console.error(`[voice-recording] Late-delivery sweep tick for ${id} failed:`, error);
      }
    }));
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
