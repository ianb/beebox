// # MicCapture borrowed mode
//
// A call recording (docs/implemented-plans/chat-calls.md, Track F) records the call's own
// microphone stream. The capture must never stop that stream's track or
// acquire a new one: the call keeps using it. When the track ends, the capture
// reports it once and does not try to recover.

import { test } from "tap";
import "@ianbicking/tap-check/tap";

class FakeTrack extends EventTarget {
  stops = 0;
  stop(): void {
    this.stops += 1;
  }
}

const track = new FakeTrack();
let acquisitions = 0;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    mediaDevices: {
      getUserMedia: async () => {
        acquisitions += 1;
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  },
});

const { MicCapture } = await import("../../../../src/lib/audio/mic-capture/core.js");

void test("a borrowed track ends: reported once, never stopped or re-acquired", async (t) => {
  // The call engine's stream, from the (fake) getUserMedia it called itself.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const events: string[] = [];
  const mic = new MicCapture(
    { onPcm: () => {}, onMicLost: () => events.push("lost"), onMicRestored: () => events.push("restored") },
    { borrowed: stream },
  );

  track.dispatchEvent(new Event("ended"));
  await mic.beginRecovery();
  mic.stopCapture();
  // Ending again after the capture let go reaches nobody.
  track.dispatchEvent(new Event("ended"));

  t.check({ events, stops: track.stops, acquisitions }, { events: ["lost"], stops: 0, acquisitions: 1 });
});
