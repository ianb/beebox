/**
 * Lightweight, opt-in instrumentation for speech playback.
 *
 * The speech pipeline (TTS fetch → audio playback) is hard to assert against
 * from outside the browser. This records timestamped lifecycle events into a
 * global array — but ONLY when something has installed `window.__speechTestLog`
 * first. In normal use the global is absent and every call is a cheap no-op,
 * so production never accumulates events or logs noise.
 *
 * The browser test harness (dev-only /dev/speech route) installs the array,
 * drives the UI, and reads back the event sequence to verify behavior and
 * timing (e.g. that streaming playback starts before the download completes).
 */

export interface SpeechTestEvent {
  /** High-resolution timestamp (ms) from performance.now(). */
  t: number;
  event: string;
  detail?: unknown;
}

declare global {
  interface Window {
    __speechTestLog?: SpeechTestEvent[];
    /** Mirror of the playback hook state, for the dev test harness. */
    __speechState?: {
      isPlaying: boolean;
      playingMessageId: string | null;
      statusMessageId: string | null;
      segmentStates: Record<number, "waiting" | "playing" | "failed">;
      remainingCount: number;
    };
    /** Imperative playback handles, for the dev test harness. */
    __speechHarness?: {
      play: () => void;
      replay: (fromIndex: number) => void;
      skip: () => void;
      stop: () => void;
    };
  }
}

export function logSpeechEvent(event: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  const log = window.__speechTestLog;
  if (log === undefined) return;
  log.push({ t: performance.now(), event, detail });
}
