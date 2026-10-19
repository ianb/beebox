// # Deepgram word extraction — boundary guard
//
// `extractFinalWords` (`src/frontend/src/machines/transcription-connections.ts`)
// reads `msg.channel.alternatives[0].words[]` off a raw-`JSON.parse`'d Deepgram
// message — not zod-validated, per the plan's Track 2 spec
// (`docs/plans/transcript-confidence.md`). It prefers `punctuated_word` (to
// match how `accumulatedFinal` is built from the smart-formatted transcript),
// attaches `confidence` only when it's a real number, and skips a malformed
// entry rather than failing the whole message.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { extractFinalWords } from "../../../src/machines/realtime-transcription-live/transcription-connections.js";

// ## Well-formed words: punctuated_word preferred, confidence carried
void test("Well-formed words: punctuated_word preferred, confidence carried", async (t) => {
  // doctest:L18
  const msg = {
    type: "Results",
    is_final: true,
    channel: {
      alternatives: [{
        transcript: "Hello, world.",
        words: [
          { word: "hello", punctuated_word: "Hello,", confidence: 0.98 },
          { word: "world", punctuated_word: "world.", confidence: 0.42 },
        ],
      }],
    },
  };
  t.check(extractFinalWords(msg), [
    {
      word: "Hello,",
      confidence: 0.98,
    },
    {
      word: "world.",
      confidence: 0.42,
    },
  ]);
});

// ## Non-numeric confidence is dropped, not coerced
void test("Non-numeric confidence is dropped, not coerced", async (t) => {
  // doctest:L38
  const msg = {
    channel: { alternatives: [{ words: [{ word: "hi", confidence: "0.9" }] }] },
  };
  t.check(extractFinalWords(msg), [
    {
      word: "hi",
    },
  ]);
});

// ## No punctuated_word: falls back to word
void test("No punctuated_word: falls back to word", async (t) => {
  // doctest:L48
  const msg = {
    channel: { alternatives: [{ words: [{ word: "hi", confidence: 0.5 }] }] },
  };
  t.check(extractFinalWords(msg), [
    {
      word: "hi",
      confidence: 0.5,
    },
  ]);
});

// ## An entry with no usable string word is skipped, not fatal
void test("An entry with no usable string word is skipped, not fatal", async (t) => {
  // doctest:L58
  const msg = {
    channel: {
      alternatives: [{
        words: [
          { confidence: 0.9 },
          { word: 42, confidence: 0.9 },
          { word: "ok", confidence: 0.9 },
        ],
      }],
    },
  };
  t.check(extractFinalWords(msg), [
    {
      word: "ok",
      confidence: 0.9,
    },
  ]);
});

// ## Malformed shape at any level returns an empty list
void test("Malformed shape at any level returns an empty list", async (t) => {
  t.check(extractFinalWords(null), []);
  t.check(extractFinalWords({}), []);
  t.check(extractFinalWords({ channel: {} }), []);
  t.check(extractFinalWords({ channel: { alternatives: [] } }), []);
  t.check(extractFinalWords({ channel: { alternatives: [{ words: "not-an-array" }] } }), []);
});
