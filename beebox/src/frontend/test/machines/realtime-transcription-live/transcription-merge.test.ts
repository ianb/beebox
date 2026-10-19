// # Transcription reconnect merge — text and words stay in lockstep
//
// `mergeFinalText`/`mergeFinalWords` (`src/frontend/src/machines/transcription-merge.ts`)
// are the pure functions `TranscriptionSession` (`transcription-actor.ts`) calls
// at every point it folds a dying connection's confirmed text/words into the
// segment's committed prefix across a reconnect. They're called at the *same*
// call sites with the *same* shape, so the word list can never drift out of
// step with the text it describes — the Track 2 reconnect direction detail in
// `docs/plans/transcript-confidence.md`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mergeFinalText, mergeFinalWords } from "../../../src/machines/realtime-transcription-live/transcription-merge.js";

// ## No committed prefix yet (first connection of a segment)
void test("No committed prefix yet (first connection of a segment)", async (t) => {
  // doctest:L18
  t.check(mergeFinalText("", "hello world"), "hello world");

  // doctest:L21
  t.check(mergeFinalWords([], [{ word: "hello" }, { word: "world", confidence: 0.9 }]), [
    {
      word: "hello",
    },
    {
      word: "world",
      confidence: 0.9,
    },
  ]);
});

// ## A committed prefix is prepended
void test("A committed prefix is prepended", async (t) => {
  // doctest:L28
  t.check(mergeFinalText("hello", "world"), "hello world");

  // doctest:L31
  t.check(mergeFinalWords([{ word: "hello", confidence: 0.99 }], [{ word: "world", confidence: 0.9 }]), [
    {
      word: "hello",
      confidence: 0.99,
    },
    {
      word: "world",
      confidence: 0.9,
    },
  ]);
});

// ## Empty new text/words fall back to just the prefix
void test("Empty new text/words fall back to just the prefix", async (t) => {
  // doctest:L38
  t.check(mergeFinalText("hello", ""), "hello");

  // doctest:L41
  t.check(mergeFinalWords([{ word: "hello" }], []), [
    {
      word: "hello",
    },
  ]);
});

// ## Two reconnects: the fold composes without dropping earlier words
//
// Mirrors `beginReconnect`'s fold sequence: connection 1 emits "hello", drops;
// connection 2 emits "there", drops again; connection 3 emits "world".
void test("Mirrors beginReconnect's fold sequence:", async (t) => {
  // doctest:L51
  let text = mergeFinalText("", "hello");
  let words = mergeFinalWords([], [{ word: "hello", confidence: 0.9 }]);

  // doctest:L54
  // Reconnect 1: fold connection 1's confirmed output into the prefix.
  text = mergeFinalText(text, "");
  words = mergeFinalWords(words, []);

  // doctest:L58
  // Connection 2 emits its own from-scratch accumulation.
  text = mergeFinalText(text, "there");
  words = mergeFinalWords(words, [{ word: "there", confidence: 0.4 }]);

  // doctest:L62
  // Reconnect 2: fold connection 2's confirmed output into the prefix.
  text = mergeFinalText(text, "");
  words = mergeFinalWords(words, []);

  // doctest:L66
  // Connection 3 emits its own from-scratch accumulation.
  text = mergeFinalText(text, "world");
  words = mergeFinalWords(words, [{ word: "world", confidence: 0.99 }]);

  // doctest:L70
  t.check(text, "hello there world");

  // doctest:L73
  t.check(words, [
    {
      word: "hello",
      confidence: 0.9,
    },
    {
      word: "there",
      confidence: 0.4,
    },
    {
      word: "world",
      confidence: 0.99,
    },
  ]);
});

// ## `null` stays `null` across a reconnect (Voxtral/OpenAI — Fix A)
//
// A service that never attaches confidence data reports `null`, not `[]`, at
// every connection — `mergeFinalWords` must never manufacture a `[]` that
// looks like "captured, empty" out of two "no data" folds (that's exactly
// what let a Voxtral send falsely stamp `stt="deepgram"`).
void test("A service that never attaches confidence data reports null, not [], at every...", async (t) => {
  // doctest:L85
  t.check(mergeFinalWords(null, null), null);
});

// Any side actually holding words wins — a mid-segment service switch isn't
// real, but the merge must still not lose data if it were:
void test("Any side actually holding words wins — a mid-segment service switch isn't rea...", async (t) => {
  // doctest:L93
  t.check(mergeFinalWords(null, [{ word: "hi", confidence: 0.9 }]), [
    {
      word: "hi",
      confidence: 0.9,
    },
  ]);

  // doctest:L96
  t.check(mergeFinalWords([{ word: "hi", confidence: 0.9 }], null), [
    {
      word: "hi",
      confidence: 0.9,
    },
  ]);
});
