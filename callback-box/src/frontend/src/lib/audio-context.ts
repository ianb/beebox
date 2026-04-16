/**
 * Shared audio playback for iOS Safari compatibility.
 *
 * iOS requires audio playback to originate from a user gesture.
 * The workaround: pre-allocate an HTMLAudioElement and play silence
 * during a gesture, then reuse that same element for all subsequent playback.
 * Based on the proven approach from memory-atlas.
 */

let sharedAudio: HTMLAudioElement | null = null;

function isIOS(): boolean {
  return /iP(ad|hone|od)/.test(navigator.userAgent);
}

/**
 * Call from a user gesture (click/tap) to unlock audio playback on iOS.
 * Plays a 1-second silence file through a pre-allocated Audio element.
 */
export function unlockAudioContext(): void {
  if (sharedAudio) return;
  const audio = new Audio("/earcons/silence.mp3");
  audio.preload = "auto";
  audio.play().catch((e) => {
    console.warn("[audio] Failed to unlock audio:", e);
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

/**
 * Play audio from a URL. On iOS, reuses the pre-unlocked shared element.
 * Returns a promise that resolves when playback ends.
 */
export function playAudioUrl(url: string, volume = 1): { stop: () => void; finished: Promise<void> } {
  const audio = getPlaybackAudioElement();
  let stopped = false;

  const finished = new Promise<void>((resolve) => {
    try { audio.pause(); } catch (_e) { /* ignore */ }
    audio.src = url;
    audio.volume = volume;
    audio.onended = () => resolve();
    audio.onerror = (e) => {
      console.error("[audio] playAudioUrl error:", e);
      resolve();
    };
    audio.play().catch((e) => {
      console.warn("[audio] playAudioUrl play() rejected:", e);
      resolve();
    });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { audio.pause(); } catch (_e) { /* ignore */ }
    },
    finished,
  };
}

/**
 * Play audio from an ArrayBuffer (e.g., TTS response).
 * Creates a blob URL and plays through the shared element on iOS.
 */
export function playAudioBlob(buffer: ArrayBuffer, mimeType = "audio/mpeg"): { stop: () => void; finished: Promise<void> } {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const audio = getPlaybackAudioElement();
  let stopped = false;

  console.log(
    `[audio] playAudioBlob start bytes=${buffer.byteLength} mime=${mimeType} shared=${sharedAudio === audio ? 1 : 0} iOS=${isIOS() ? 1 : 0}`
  );

  const finished = new Promise<void>((resolve) => {
    try { audio.pause(); } catch (_e) { /* ignore */ }
    audio.onended = () => {
      URL.revokeObjectURL(url);
      console.log(`[audio] playAudioBlob ended duration=${audio.duration}s`);
      resolve();
    };
    audio.onerror = (e) => {
      URL.revokeObjectURL(url);
      const mediaErr = audio.error;
      console.warn(
        `[audio] playAudioBlob error code=${mediaErr?.code} msg="${mediaErr?.message ?? ""}" event=${String(e).slice(0, 80)}`
      );
      resolve();
    };
    audio.src = url;
    audio.volume = 1;
    audio.play()
      .then(() => {
        console.log("[audio] playAudioBlob play() resolved");
      })
      .catch((e) => {
        URL.revokeObjectURL(url);
        console.warn(
          `[audio] playAudioBlob play() rejected name=${e?.name ?? "?"} message="${e?.message ?? String(e)}"`
        );
        resolve();
      });
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { audio.pause(); } catch (_e) { /* ignore */ }
    },
    finished,
  };
}
