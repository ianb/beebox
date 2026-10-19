// # Style delivery: where each backend's direction goes
//
// The boxholder writes speaking style once, on the personality card.
// `deliverStyle` (`src/core/tts/style.ts`) is the pure decision about where each
// backend takes it — pure precisely because getting it wrong is inaudible to us
// and audible to them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { deliverStyle } from "../../../src/core/tts/style.js";

// ## Both backends have a field for it
//
// OpenAI's speech request has `instructions`; Google's Interactions API has a
// `speech_metadata` annotation. Either way the direction travels beside the
// text, never inside it: Gemini 3.8 reads direction placed in the text aloud
// (measured 2026-10-04), which is why Gemini speech has no OpenRouter route.
void test("OpenAI's speech request has instructions; Google's Interactions API has a spe...", async (t) => {
  // doctest:L20
  t.check(deliverStyle({ backend: "openai", instructions: "Speak warmly." }), {
    kind: "field",
    instructions: "Speak warmly.",
  });

  // doctest:L23
  t.check(deliverStyle({ backend: "gemini", instructions: "  Speak warmly.  " }), {
    kind: "field",
    instructions: "Speak warmly.",
  });
});

// ## No direction is not the same as a backend that cannot take one
//
// With nothing to place, nothing is reported as dropped — an empty
// `instructions` must not be logged as a lost setting.
void test("With nothing to place, nothing is reported as dropped — an empty instructions...", async (t) => {
  // doctest:L33
  t.check(deliverStyle({ backend: "gemini", instructions: undefined }), {
    kind: "none",
  });

  // doctest:L36
  t.check(deliverStyle({ backend: "openai", instructions: "   " }), {
    kind: "none",
  });
});
