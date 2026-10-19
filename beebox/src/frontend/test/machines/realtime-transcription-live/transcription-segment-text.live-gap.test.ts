// # Live gap marker — where the live transcript went offline
//
// When the live transcription socket drops mid-recording, the recording keeps
// going and the HQ pass later fills in the words. The live transcript shows
// `[…]` where live text is missing (`docs/implemented-plans/live-gap-marker.md`), so a send
// in that state does not look like the box lost the words. The decisions live in
// two pure pieces `TranscriptionSession` (`transcription-actor.ts`) wires
// together: `ReplayRing.coversGap` (was every frame of the outage replayed?) and
// `SegmentTranscript` (where the marker sits, and when it goes).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ReplayRing } from "../../../src/machines/realtime-transcription-live/transcription-replay-ring.js";
import { SegmentTranscript } from "../../../src/machines/realtime-transcription-live/transcription-segment-text.js";

function ringWith(frames: number): ReplayRing {
  const ring = new ReplayRing({ capacity: 100 });
  for (let i = 0; i < frames; i++) ring.push(new ArrayBuffer(1));
  return ring;
}

// ## A covered gap: the ring still holds every frame since the outage
//
// The replay pad (frames before the drop, re-sent for detection latency) does
// not count against coverage: 95 frames after a drop fit a 100-frame ring even
// though the replay sends 100 frames starting 10 before it.
void test("The replay pad (frames before the drop, re-sent for detection latency) does n...", async (t) => {
  // doctest:L29
  const ring = ringWith(200);
  ring.markGap({ padFrames: 10 });
  for (let i = 0; i < 95; i++) ring.push(new ArrayBuffer(1));
  t.check({ covered: ring.coversGap(), replayed: ring.sinceGap().length }, {
    covered: true,
    replayed: 100,
  });

  // An outage longer than the ring is not covered: its oldest audio is never
  // replayed.

  // doctest:L40
  for (let i = 0; i < 10; i++) ring.push(new ArrayBuffer(1));
  t.check(ring.coversGap(), false);
});

// ## A drop marks the gap after the last live words
//
// `openGap` folds the connection's final text and appends the marker once; two
// drops before any new text leave one marker.
void test("openGap folds the connection's final text and appends the marker once; two dr...", async (t) => {
  // doctest:L51
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "pick up the dry cleaning", finalWords: null });
  text.openGap();
  text.openGap();
  t.check(text.textWith(""), "pick up the dry cleaning […]");

  // ## A covered reconnect keeps the marker until new words arrive
  //
  // The replay has the audio, but the recognizer has not transcribed it yet. A
  // send in this window still shows the marker; the first non-empty final text
  // from the new connection removes it.

  // doctest:L67
  t.check(text.connected({ covered: true }), false);

  // doctest:L70
  t.check(text.textWith(""), "pick up the dry cleaning […]");

  // doctest:L73
  t.check(text.update({ finalText: "", finalWords: null }).text, "pick up the dry cleaning […]");

  // doctest:L76
  t.check(text.update({ finalText: "and then the milk", finalWords: null }).text, "pick up the dry cleaning and then the milk");
});

// ## An uncovered reconnect keeps the marker for good
//
// New text appends after it.
void test("New text appends after it.", async (t) => {
  // doctest:L85
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "first part", finalWords: null });
  text.openGap();
  text.connected({ covered: false });
  t.check(text.update({ finalText: "later part", finalWords: null }).text, "first part […] later part");
});

// ## Live text given up for the segment
//
// `abandonLive` opens the gap with no reconnect to follow: the marker stays at
// the end, and the segment's final text carries it to the send.
void test("abandonLive opens the gap with no reconnect to follow:", async (t) => {
  // doctest:L100
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "the meeting moved to", finalWords: null });
  text.openGap();
  t.check(text.textWith(""), "the meeting moved to […]");
});

// ## The first connection
//
// Nothing is marked while the first socket opens. If it opens so late that the
// replay cannot cover the wait, the marker goes at the start.
void test("Nothing is marked while the first socket opens.", async (t) => {
  // doctest:L114
  const quick = new SegmentTranscript();
  t.check(quick.connected({ covered: true }), false);

  // doctest:L118
  const late = new SegmentTranscript();
  t.check(late.connected({ covered: false }), true);

  // doctest:L122
  await t.checkText(late.update({ finalText: "and the rest", finalWords: null }).text, "[…] and the rest");
});

// ## A drop before any words leaves the text blank
//
// The boxholder decided this on 2026-10-13. No text before the drop most likely
// means no speech during it. Blank text and text holding only `[…]` behave
// differently downstream: one is an empty recording, the other is a message.
// So the drop marks nothing, and words after the reconnect start the text.
void test("The boxholder decided this on 2026-10-13.", async (t) => {
  // doctest:L134
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "  ", finalWords: null });
  text.openGap();
  t.check(({ text: text.textWith("") }), {
    text: "",
  });

  // doctest:L141
  text.connected({ covered: false });
  t.check(text.update({ finalText: "hello", finalWords: null }).text, "hello");
});

// ## Words stay with their text
//
// The marker is text only; word lists (Deepgram confidence) merge as before.
void test("The marker is text only; word lists (Deepgram confidence) merge as before.", async (t) => {
  // doctest:L151
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "hello", finalWords: [{ word: "hello", confidence: 0.9 }] });
  text.openGap();
  text.connected({ covered: false });
  t.check(text.update({ finalText: "world", finalWords: [{ word: "world", confidence: 0.4 }] }), {
    text: "hello […] world",
    words: [
      {
        word: "hello",
        confidence: 0.9,
      },
      {
        word: "world",
        confidence: 0.4,
      },
    ],
  });
});

// ## A second drop before any new words keeps the first gap
//
// A covered reconnect is waiting for its first words when live text drops
// again. The first outage may now lie outside the next replay, so the one
// marker stays even if the next reconnect is covered.
void test("A covered reconnect is waiting for its first words when live text drops again.", async (t) => {
  // doctest:L167
  const text = new SegmentTranscript();
  text.connected({ covered: true });
  text.update({ finalText: "before", finalWords: null });
  text.openGap();
  text.connected({ covered: true });
  text.openGap();
  text.connected({ covered: true });
  t.check(text.update({ finalText: "after", finalWords: null }).text, "before […] after");
});
