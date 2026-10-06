/**
 * Shared audio playback for iOS Safari compatibility.
 *
 * iOS requires audio playback to originate from a user gesture.
 * The workaround: pre-allocate an HTMLAudioElement and play silence
 * during a gesture, then reuse that same element for all subsequent
 * playback (earcons + TTS) by swapping `.src`. Based on the proven
 * approach from memory-atlas.
 *
 * Two constraints that bite if violated:
 *   - `unlockAudioContext()` MUST be called in the synchronous call
 *     stack of the click/tap handler — not after an `await`, not from
 *     a microtask. Otherwise iOS treats the call as non-gesture.
 *   - The Web Audio `AudioContext` API does NOT reliably work for
 *     this on iOS; use the HTMLAudioElement approach here.
 */

import { withBase } from "../../api";
import { logSpeechEvent } from "./speech-test-log";

class BufferedSpeechPlaybackError extends Error {
  constructor() {
    super("Buffered speech audio failed during playback");
    this.name = "BufferedSpeechPlaybackError";
  }
}

let sharedAudio: HTMLAudioElement | null = null;

type MediaOperation = "unlock" | "url" | "blob" | "stream";

interface MediaDiagnosticState {
  error: { code: number } | null;
  networkState: number;
  readyState: number;
}

const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

const NETWORK_STATE_NAMES: Record<number, string> = {
  0: "NETWORK_EMPTY",
  1: "NETWORK_IDLE",
  2: "NETWORK_LOADING",
  3: "NETWORK_NO_SOURCE",
};

const READY_STATE_NAMES: Record<number, string> = {
  0: "HAVE_NOTHING",
  1: "HAVE_METADATA",
  2: "HAVE_CURRENT_DATA",
  3: "HAVE_FUTURE_DATA",
  4: "HAVE_ENOUGH_DATA",
};

function labeledMediaValue(value: number, names: Record<number, string>): string {
  return `${names[value] ?? "UNKNOWN"}(${value})`;
}

export function formatMediaElementFailure(
  operation: MediaOperation,
  state: MediaDiagnosticState,
): string {
  const mediaError = state.error
    ? labeledMediaValue(state.error.code, MEDIA_ERROR_NAMES)
    : "none";
  return `[audio] operation=${operation} mediaError=${mediaError}`
    + ` networkState=${labeledMediaValue(state.networkState, NETWORK_STATE_NAMES)}`
    + ` readyState=${labeledMediaValue(state.readyState, READY_STATE_NAMES)}`;
}

export function formatPlaybackRejection(operation: MediaOperation, error: unknown): string {
  return `[audio] operation=${operation} play() rejected ${formatThrownError(error)}`;
}

export function formatThrownError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isIOS(): boolean {
  return /iP(ad|hone|od)/.test(navigator.userAgent);
}

/**
 * Whether to prefetch upcoming TTS audio while the current segment plays.
 * Disabled on iOS because the shared-Audio-element gymnastics around
 * gesture-locked playback complicate any benefit prefetching would offer.
 */
export function shouldPrefetchSpeech(): boolean {
  return !isIOS();
}

/**
 * Whether incremental (streaming) playback via MediaSource is usable. Lets
 * the head segment of a response start playing after its first chunk arrives
 * instead of waiting for the whole download. Disabled on iOS (iPhone Safari
 * lacks MSE and uses the gesture-locked shared element) and anywhere mp3
 * source buffers aren't supported.
 */
export function supportsMediaSource(): boolean {
  return (
    !isIOS() &&
    typeof MediaSource !== "undefined" &&
    MediaSource.isTypeSupported("audio/mpeg")
  );
}

/**
 * Call from a user gesture (click/tap) to unlock audio playback on iOS.
 * Plays a 1-second silence file through a pre-allocated Audio element.
 */
export function unlockAudioContext(): void {
  if (sharedAudio) return;
  const audio = new Audio(withBase("/earcons/silence.mp3"));
  audio.preload = "auto";
  audio.play().catch((e) => {
    console.warn(formatPlaybackRejection("unlock", e));
  });
  sharedAudio = audio;
}

/**
 * Get the shared audio element (pre-unlocked on iOS).
 * On non-iOS, returns a new Audio element each time.
 */
export function getPlaybackAudioElement(): HTMLAudioElement {
  if (isIOS() && sharedAudio) {
    return sharedAudio;
  }
  return new Audio();
}

export interface Playback {
  stop: () => void;
  finished: Promise<void>;
}

/**
 * Play audio from a URL. On iOS, reuses the pre-unlocked shared element.
 * Returns a promise that resolves when playback ends OR when stop() is called.
 */
export function playAudioUrl(url: string, opts?: { volume?: number; label?: string }): Playback {
  const volume = opts && opts.volume !== undefined ? opts.volume : 1;
  const label = opts ? opts.label : undefined;
  const audio = getPlaybackAudioElement();
  let stopped = false;
  let settle: () => void = () => {};

  const finished = new Promise<void>((resolve) => {
    settle = resolve;
    try { audio.pause(); } catch (_e) { /* ignore */ }
    audio.src = url;
    audio.volume = volume;
    audio.onplaying = () => logSpeechEvent("audio.start", { label });
    audio.onended = () => { logSpeechEvent("audio.end", { label }); resolve(); };
    audio.onerror = () => {
      console.error(formatMediaElementFailure("url", audio));
      resolve();
    };
    audio.play().catch((e) => {
      console.warn(formatPlaybackRejection("url", e));
      resolve();
    });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { audio.pause(); } catch (_e) { /* ignore */ }
      logSpeechEvent("audio.end", { label, stopped: true });
      settle();
    },
    finished,
  };
}

/**
 * Play audio from an ArrayBuffer (e.g., a fully-downloaded or cached TTS
 * response). Creates a blob URL and plays through the shared element on iOS.
 * `finished` resolves on natural end OR when stop() is called.
 */
export function playAudioBlob(
  buffer: ArrayBuffer,
  opts?: { mimeType?: string; label?: string; onPlaying?: () => void },
): Playback {
  const mimeType = opts && opts.mimeType ? opts.mimeType : "audio/mpeg";
  const label = opts ? opts.label : undefined;
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const audio = getPlaybackAudioElement();
  let stopped = false;
  let settle: () => void = () => {};

  const finished = new Promise<void>((resolve, reject) => {
    settle = resolve;
    try { audio.pause(); } catch (_e) { /* ignore */ }
    audio.onplaying = () => {
      logSpeechEvent("audio.start", { label });
      opts?.onPlaying?.();
    };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      logSpeechEvent("audio.end", { label });
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      console.error(formatMediaElementFailure("blob", audio));
      reject(new BufferedSpeechPlaybackError());
    };
    audio.src = url;
    audio.volume = 1;
    audio.play().catch((e) => {
      URL.revokeObjectURL(url);
      console.error(formatPlaybackRejection("blob", e));
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { audio.pause(); } catch (_e) { /* ignore */ }
      URL.revokeObjectURL(url);
      logSpeechEvent("audio.end", { label, stopped: true });
      settle();
    },
    finished,
  };
}
