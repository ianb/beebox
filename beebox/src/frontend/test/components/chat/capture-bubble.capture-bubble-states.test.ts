// # Capture bubble faces
//
// Every state a staged capture can be in gets a face in chat. It didn't before,
// and each missing one cost the boxholder something: a capture that succeeded
// said nothing (so they re-captured, and an agent had to reconcile the
// duplicate), and one that failed said `failed — tap to retry` for sixteen days
// with no way to make it stop.
//
// The phase and caption are pure functions of the model plus a clock, so all of
// it is reachable here without a backend.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  type CaptureBubbleModel,
  captureBubblePhase,
  captureBubbleCaption,
  captureBubbleAgeMs,
  captureMediaSummary,
} from "../../../src/components/chat/capture-bubble.js";

const NOW = Date.parse("2026-08-21T12:00:00Z");
const agesAgo = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const COUNTS = { photos: 2, files: 1, audioSegments: 3 };

// One bubble, `ms` old, in whatever state the caller names. `startedAt` and
// `lastActivityAt` coincide unless a test says otherwise; a test adds fields by
// spreading the result.
const bubble = (state: string, ms: number): CaptureBubbleModel => ({
  id: "b", state, counts: COUNTS, startedAt: agesAgo(ms), lastActivityAt: agesAgo(ms),
});
const faceOf = (model: CaptureBubbleModel) => {
  const age = captureBubbleAgeMs(model, NOW);
  return `${captureBubblePhase(model, age)}: ${captureBubbleCaption(model, NOW)}`;
};

// ## A working capture names its step, and eventually its age
//
// Preparation takes about a minute. Under the patience window the caption is just
// the step; past it, the caption starts reporting how long it has been — a silent
// minute is what the boxholder read as failure.
void test("Preparation takes about a minute.", async (t) => {
  t.check(faceOf(bubble("preparing", 5_000)), "working: preparing…");

  t.check(faceOf({ ...bubble("preparing", 5_000), liveStatus: "transcribing" }), "working: transcribing…");

  t.check(faceOf(bubble("delivering", 5_000)), "working: queued…");

  t.check(faceOf(bubble("preparing", 4 * MINUTE)), "working: still preparing — 4m");
});

// ## Success has a face of its own
//
// Delivery used to be rendered as the row vanishing, which is indistinguishable
// from nothing having happened. A resolved capture keeps its row for a moment and
// says which ending it got:
void test("Delivery used to be rendered as the row vanishing, which is indistinguishable...", async (t) => {
  t.check(faceOf({ ...bubble("delivering", MINUTE), resolution: "delivered" }), "resolved: delivered");

  t.check(faceOf({ ...bubble("failed:prepare", 3 * DAY), resolution: "discarded" }), "resolved: discarded");
});

// ## A failure carries its age, and ages into a different answer
//
// The abandonment sweep already draws this line: past the window it classifies a
// `failed:*` capture as needing a human and deliberately declines to retry it on
// its own. The chip now draws the same line, which is what decides whether Retry
// or Discard is the emphasized verb.
void test("The abandonment sweep already draws this line:", async (t) => {
  t.check(faceOf(bubble("failed:deliver", 10_000)), "failed-fresh: failed just now");

  t.check(faceOf(bubble("failed:deliver", 20 * MINUTE)), "failed-fresh: failed 20m ago");

  t.check(faceOf(bubble("failed:prepare", 90 * MINUTE)), "failed-aged: failed 1h ago");

  t.check(faceOf(bubble("failed:prepare", 16 * DAY)), "failed-aged: failed Aug 5");
});

// A failure ages from `lastActivityAt`, not from when the capture was created —
// otherwise a weeks-old capture that failed again a minute ago would be
// emphasized for discard on the strength of its age alone, and a retry that just
// failed would report the age of the original attempt:
void test("A failure ages from lastActivityAt, not from when the capture was created — o...", async (t) => {
  t.check(faceOf({ ...bubble("failed:deliver", 20 * DAY), lastActivityAt: agesAgo(2 * MINUTE) }), "failed-fresh: failed 2m ago");
});

// A live `failed` event counts as failure even while the query still says the
// capture is preparing:
void test("A live failed event counts as failure even while the query still says the cap...", async (t) => {
  t.check(faceOf({ ...bubble("preparing", 10 * MINUTE), liveStatus: "failed" }), "failed-fresh: failed 10m ago");
});

// ## Without a clock, nothing is claimed
//
// The first frame renders before the wall clock is read (and `startedAt` could in
// principle be unparseable). Both fall back to un-aged text rather than inventing
// a duration — and an un-aged failure is treated as fresh, because emphasizing
// discard is a judgement that needs the age to support it.
void test("The first frame renders before the wall clock is read (and startedAt could in...", async (t) => {
  const noClock = bubble("failed:prepare", 16 * DAY);
  t.check(`${captureBubblePhase(noClock, null)}: ${captureBubbleCaption(noClock, 0)}`, "failed-fresh: failed");

  t.check(captureBubbleAgeMs({ ...noClock, lastActivityAt: "not a date" }, NOW), null);

  t.check(captureBubbleAgeMs({ ...bubble("preparing", MINUTE), startedAt: "not a date" }, NOW), null);

  t.check(captureBubbleAgeMs(noClock, 0), null);
});

// ## An action that failed says so in place of the caption
//
// A retry or discard that came back with an error takes over the caption — a
// user-initiated action never silently no-ops.
void test("A retry or discard that came back with an error takes over the caption — a us...", async (t) => {
  t.check(faceOf({ ...bubble("failed:prepare", 2 * DAY), actionError: "couldn't discard — Cancel failed: 409" }), "failed-aged: couldn't discard — Cancel failed: 409");
});

// ## The tally names what would be lost
//
// Discard deletes staged media that reached no other surface, so the confirmation
// has to say what it is deleting:
void test("Discard deletes staged media that reached no other surface, so the confirmati...", async (t) => {
  t.check(captureMediaSummary(COUNTS), "2 photos, 3 clips, 1 file");

  t.check(captureMediaSummary({ photos: 7, files: 0, audioSegments: 1 }), "7 photos, 1 clip");

  t.check(captureMediaSummary({ photos: 0, files: 0, audioSegments: 0 }), "capture");
});
