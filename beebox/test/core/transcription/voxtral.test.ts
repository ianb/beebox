// # Voxtral transcription helpers
//
// The Voxtral non-streaming API returns both a top-level `text` field
// (the joined transcript) and a `segments` array with per-chunk text.
// The `text` field occasionally concatenates sentence-end + next
// sentence without a space ("have gone.Generic tools"). Primary fix is
// to rebuild the transcript from segments, joined with a single space —
// that's the source level. `repairMissingSentenceSpaces` is a fallback
// for responses where segments is empty.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  joinSegmentTexts,
  repairMissingSentenceSpaces,
  findLastSpeakerLetter,
  nextSpeakerLetter,
  relabelDiarizedSpeakers,
} from "../../../src/core/transcription/voxtral/core.js";
import { voxtralContextBias } from "../../../src/core/transcription/voxtral/request.js";

// ## joinSegmentTexts — rebuild from segments
//
// Two segments where the second starts with a new sentence: spaced
// correctly even if Voxtral's own `text` had no space.
void test("Two segments where the second starts with a new sentence:", async (t) => {
  t.check(
    joinSegmentTexts([
      { text: "It went the way a lot of these things have gone." },
      { text: "Generic tools were better." },
    ]),
    "It went the way a lot of these things have gone. Generic tools were better.",
  );
});

// Empty / whitespace-only segments are dropped; the rest still join.
void test("Empty / whitespace-only segments are dropped; the rest still join.", async (t) => {
  t.check(
    joinSegmentTexts([
      { text: "First sentence." },
      { text: "   " },
      { text: "Second sentence." },
    ]),
    "First sentence. Second sentence.",
  );

  t.check(joinSegmentTexts([]), null);

  t.check(joinSegmentTexts(undefined), null);

  t.check(joinSegmentTexts([{ text: "" }, { text: "  " }]), null);
});

// ## The bug case — sentence-end followed by a letter
void test("The bug case — sentence-end followed by a letter", async (t) => {
  t.check(repairMissingSentenceSpaces("It went the way a lot of these things have gone.Generic tools were better."), "It went the way a lot of these things have gone. Generic tools were better.");

  t.check(repairMissingSentenceSpaces("Where I said elements, it's actually LLMs.see how that goes."), "Where I said elements, it's actually LLMs. see how that goes.");

  t.check(repairMissingSentenceSpaces("Yes!What?Maybe.Now go."), "Yes! What? Maybe. Now go.");
});

// ## Don't break decimals or ellipses
void test("Don't break decimals or ellipses", async (t) => {
  t.check(repairMissingSentenceSpaces("Version 1.2 released"), "Version 1.2 released");

  t.check(repairMissingSentenceSpaces("Wait... what?"), "Wait... what?");

  t.check(repairMissingSentenceSpaces("The price is $9.99"), "The price is $9.99");
});

// ## Already-spaced text is untouched
void test("Already-spaced text is untouched", async (t) => {
  t.check(repairMissingSentenceSpaces("One sentence. Another sentence."), "One sentence. Another sentence.");
});

// ## Per-recording speaker letter
//
// Diarized recordings get a session-letter so the agent can tell that
// identical speaker numbers from different recordings are different
// people. `findLastSpeakerLetter` scans prior session text;
// `nextSpeakerLetter` advances; `relabelDiarizedSpeakers` rewrites the
// raw `Speaker N` prefix to `Speaker (N+1)<letter>`.
void test("Diarized recordings get a session-letter so the agent can tell that identical...", async (t) => {
  t.check(findLastSpeakerLetter(""), null);

  t.check(findLastSpeakerLetter("no labels here"), null);

  t.check(findLastSpeakerLetter("earlier: Speaker 1A: hi\nlater: Speaker 2C: bye"), "C");

  t.check(findLastSpeakerLetter("Speaker 10F: ok"), "F");
});

void test("Per-recording speaker letter", async (t) => {
  t.check(nextSpeakerLetter(null), "A");

  t.check(nextSpeakerLetter("A"), "B");

  t.check(nextSpeakerLetter("Y"), "Z");

  t.check(nextSpeakerLetter("Z"), "A");
});

void test("Per-recording speaker letter (line 123)", async (t) => {
  await t.checkText(relabelDiarizedSpeakers("Speaker 0: hi\nSpeaker 1: bye", "B"), `Speaker 1B: hi
Speaker 2B: bye`);

  t.check(relabelDiarizedSpeakers("Speaker 0: solo", "A"), "Speaker 1A: solo");
});

// ## voxtralContextBias — the prompt in the shape the API accepts
//
// voxtral-mini-latest takes `context_bias` as comma-separated single words and
// answers 400 for an entry with whitespace (issue
// 2026-10-23-voxtral-context-bias-rejects-multi-word-prompt). Re-transcription
// sends a card's whole earlier transcript as the prompt.

void test("A transcript prompt becomes unique single words", async (t) => {
  t.check(
    voxtralContextBias("Thanks, Brian. We're making solid strides on Monro Forward — thanks, Brian!"),
    "Thanks,Brian,We're,making,solid,strides,on,Monro,Forward,thanks",
  );
});

void test("Inner punctuation stays; edge punctuation and empty input go", async (t) => {
  t.check(voxtralContextBias("Brian D'Ambrosia, re-image (Kraków) 3rd."), "Brian,D'Ambrosia,re-image,Kraków,3rd");

  t.check(voxtralContextBias(" , — ... "), "");
});
