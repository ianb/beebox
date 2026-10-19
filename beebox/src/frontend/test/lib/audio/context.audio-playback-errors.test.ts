// # Speech media errors
//
// The low-level buffered-audio player must reject when the browser refuses
// `audio.play()`. Resolving here would make the speech machine treat a failed
// segment as successfully spoken and rapidly advance through the whole queue.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  formatMediaElementFailure,
  formatPlaybackRejection,
  formatThrownError,
  playAudioBlob,
} from "../../../src/lib/audio/context.js";

Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "doctest browser" },
  configurable: true,
});

class RejectingAudio {
  src = "";
  volume = 1;
  onplaying = null;
  onended = null;
  onerror = null;

  pause() {}

  async play() {
    throw new Error("mock browser rejected playback");
  }
}

Object.defineProperty(globalThis, "Audio", { value: RejectingAudio, configurable: true });

// ## A rejected play is a failed segment
void test("A rejected play is a failed segment", async (t) => {
  const playbackErrors: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args) => playbackErrors.push(args);
  const playback = playAudioBlob(new Uint8Array([1, 2, 3]).buffer);
  await t.checkThrows(() => playback.finished, "Error: mock browser rejected playback");
  console.error = originalConsoleError;
  t.check(playbackErrors, [
    [
      "[audio] operation=blob play() rejected Error: mock browser rejected playback",
    ],
  ]);
});

// ## Forwarded diagnostics carry browser media state
//
// The browser gives an `Event` to `onerror`, which serializes as `{}`. Format the
// media element's stable diagnostic fields instead.
void test("The browser gives an Event to onerror, which serializes as {}.", async (t) => {
  await t.checkText(
    formatMediaElementFailure("url", {
      error: { code: 3 },
      networkState: 2,
      readyState: 1,
    }),
    "[audio] operation=url mediaError=MEDIA_ERR_DECODE(3) networkState=NETWORK_LOADING(2) readyState=HAVE_METADATA(1)",
  );

  await t.checkText(
    formatMediaElementFailure("stream", {
      error: null,
      networkState: 3,
      readyState: 0,
    }),
    "[audio] operation=stream mediaError=none networkState=NETWORK_NO_SOURCE(3) readyState=HAVE_NOTHING(0)",
  );

  await t.checkText(
    formatMediaElementFailure("blob", {
      error: { code: 99 },
      networkState: 99,
      readyState: 99,
    }),
    "[audio] operation=blob mediaError=UNKNOWN(99) networkState=UNKNOWN(99) readyState=UNKNOWN(99)",
  );

  await t.checkText(formatPlaybackRejection("blob", new DOMException("Playback needs a gesture", "NotAllowedError")), "[audio] operation=blob play() rejected NotAllowedError: Playback needs a gesture");

  t.check(formatThrownError(new TypeError("Unsupported MIME type")), "TypeError: Unsupported MIME type");
});
