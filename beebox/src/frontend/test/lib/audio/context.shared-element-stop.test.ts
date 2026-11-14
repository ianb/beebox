// # Stopping a playback on iOS's shared audio element
//
// On iOS every `playAudioUrl` plays through one pre-unlocked element
// (`unlockAudioContext`). Stopping an older playback, such as a call's ring
// ending after speech has started, must not pause the newer one.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { playAudioUrl, unlockAudioContext } from "../../../src/lib/audio/context.js";

Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, configurable: true });

const pauses: string[] = [];

class RecordingAudio {
  src = "";
  volume = 1;
  muted = false;
  onplaying = null;
  onended = null;
  onerror = null;
  pause() {
    pauses.push(this.src);
  }
  async play() {}
  load() {}
}

Object.defineProperty(globalThis, "Audio", { value: RecordingAudio, configurable: true });

void test("an older playback's stop leaves the newer one playing; the newer one's stop pauses it", async (t) => {
  unlockAudioContext();
  const ring = playAudioUrl("/earcons/call-ring.wav");
  const speech = playAudioUrl("/speech.mp3");
  pauses.length = 0;
  ring.stop();
  t.check(pauses, []);
  speech.stop();
  t.check(pauses, ["/speech.mp3"]);
});
