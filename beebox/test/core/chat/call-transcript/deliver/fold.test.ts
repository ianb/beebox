// # Folding a call transcript
//
// `foldCall` (docs/implemented-plans/chat-calls.md, Track G) turns each person's timed
// words into utterances at `firstAudioAtMs + word.start`, merges them with the
// chat's activity while transcription was on, and names anyone whose audio is
// missing or whose clock was more than a second off.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { foldCall, type FoldInput } from "../../../../../src/core/chat/call-transcript/deliver/fold.js";

const T0 = Date.parse("2026-11-12T19:02:00.000Z");
const priya = { email: "priya@example.com", name: "Priya Marlowe" };
const tomas = { email: "tomas@example.com", name: "Tomas Marlowe" };

function word(text: string, start: number) {
  return { text, start, end: start + 0.3 };
}

const base: FoldInput = {
  startedAt: T0,
  endedAt: T0 + 125_000,
  people: [priya, tomas],
  transcribingChanges: [{ by: priya, atMs: T0 + 2_000, on: true }],
  activity: [],
  recordings: [],
};

// ## Speech interleaves by wall clock; overlapping speech stays two lines
//
// Priya's device heard audio first at T0+3 s and Tomas's at T0+5 s. Priya's
// pause of more than 1.2 s starts a second utterance; Tomas speaks over it.
void test("Speech interleaves by wall clock; overlap stays two lines", async (t) => {
  t.check(foldCall({
    ...base,
    recordings: [
      { person: priya, clockOffsetMs: 40, result: { firstAudioAtMs: T0 + 3_000, text: "", words: [word("so", 1), word("Saturday", 1.4), word("dessert?", 4)] } },
      { person: tomas, clockOffsetMs: -20, result: { firstAudioAtMs: T0 + 5_000, text: "", words: [word("lemon", 1.5), word("tart", 1.9)] } },
    ],
    activity: [
      { atMs: T0 + 10_000, text: "Tomas Marlowe (in chat): bringing plates" },
      // Before transcription turned on: not part of the transcript.
      { atMs: T0 + 1_000, text: "Priya Marlowe (in chat): hi" },
    ],
  }), {
    kind: "call",
    people: "Priya Marlowe, Tomas Marlowe",
    duration: "2:05",
    started: "2026-11-12T19:02:00.000Z",
    partial: null,
    skew: null,
    transcript: [
      "[0:02] Priya Marlowe turned transcription on",
      "[0:04] Priya Marlowe: so Saturday",
      "[0:06] Tomas Marlowe: lemon tart",
      "[0:07] Priya Marlowe: dessert?",
      "[0:10] Tomas Marlowe (in chat): bringing plates",
    ].join("\n"),
  });
});

// ## Missing audio and an untimed recording make the message partial; a skewed clock adds a note
//
// Activity after transcription turned off is left out.
void test("Partial and skew notes name the person", async (t) => {
  const folded = foldCall({
    ...base,
    transcribingChanges: [
      { by: priya, atMs: T0 + 2_000, on: true },
      { by: tomas, atMs: T0 + 60_000, on: false },
    ],
    recordings: [
      { person: priya, clockOffsetMs: 3_400, result: { firstAudioAtMs: T0 + 3_000, text: "all of it", words: null } },
      { person: tomas, clockOffsetMs: 0, result: null },
    ],
    activity: [{ atMs: T0 + 90_000, text: "Box: done" }],
  });
  t.check(folded, {
    kind: "call",
    people: "Priya Marlowe, Tomas Marlowe",
    duration: "2:05",
    started: "2026-11-12T19:02:00.000Z",
    partial: "Tomas Marlowe's audio could not be transcribed; Priya Marlowe's speech has no word timing and is placed where the recording starts.",
    skew: "Priya Marlowe's clock was 3 s off; order may be wrong near overlaps.",
    transcript: [
      "[0:02] Priya Marlowe turned transcription on",
      "[0:03] Priya Marlowe: all of it",
      "[1:00] Tomas Marlowe turned transcription off",
    ].join("\n"),
  });
});
