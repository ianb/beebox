// # Voices, per backend
//
// A personality card names a voice from `VOICE_MODELS` (alloy…verse). **Zero of
// those exist on Gemini** — sending one is an HTTP 400 from the provider, not a
// graceful default — so `resolveVoice` (`src/core/tts/voices.ts`) decides what a
// backend can actually be asked for, and reports when the boxholder's choice was
// not it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { resolveVoice } from "../../../src/core/tts/voices.js";
import { VOICE_MODELS } from "../../../src/shared/voice-models.js";

// ## A voice the backend serves is used as asked
void test("A voice the backend serves is used as asked", async (t) => {
  t.check(resolveVoice({ backend: "openai", requested: "coral" }), {
    kind: "as-requested",
    voice: "coral",
  });

  t.check(resolveVoice({ backend: "gemini", requested: "Puck" }), {
    kind: "as-requested",
    voice: "Puck",
  });
});

// ## Our voices translate into Gemini's through the boxholder's mapping
//
// Every `VOICE_MODELS` name has a Gemini equivalent, chosen by ear rather than by
// pitch — so a personality card keeps naming the voices it always did, and no
// card needs migrating. `marin` maps to Achernar because the boxholder re-picked
// it by ear on 2026-10-12, replacing Vindemiatrix; `shimmer` shares it.
void test("Every VOICEMODELS name has a Gemini equivalent, chosen by ear rather than by...", async (t) => {
  t.check(resolveVoice({ backend: "gemini", requested: "marin" }), {
    kind: "mapped",
    voice: "Achernar",
    requested: "marin",
  });
});

// `mapped` is deliberately its own outcome rather than a kind of substitution:
// the boxholder picked these, so nothing was lost and nothing is warned about.
// The distinction is what keeps the warning meaningful for cases nobody chose.
void test("mapped is deliberately its own outcome rather than a kind of substitution:", async (t) => {
  const kinds = new Set(VOICE_MODELS.map((v) => resolveVoice({ backend: "gemini", requested: v }).kind));
  t.check([...kinds].join(","), "mapped");
});

// ## An unmapped, unservable voice substitutes and says what was lost
//
// There is no reverse mapping, so a Gemini voice name asked of OpenAI falls back
// and warns — the case where the boxholder really did lose their choice.
void test("There is no reverse mapping, so a Gemini voice name asked of OpenAI falls bac...", async (t) => {
  t.check(resolveVoice({ backend: "openai", requested: "Zephyr" }), {
    kind: "substituted",
    voice: "marin",
    requested: "Zephyr",
  });

  t.check(resolveVoice({ backend: "gemini", requested: "not-a-voice" }), {
    kind: "substituted",
    voice: "Zephyr",
    requested: "not-a-voice",
  });
});

// ## Asking for nothing is not a substitution
//
// There is no choice to report as overridden, so the default is returned plainly
// and nothing is warned about.
void test("There is no choice to report as overridden, so the default is returned plainl...", async (t) => {
  t.check(resolveVoice({ backend: "gemini", requested: undefined }), {
    kind: "as-requested",
    voice: "Zephyr",
  });

  t.check(resolveVoice({ backend: "openai", requested: "  " }), {
    kind: "as-requested",
    voice: "marin",
  });
});
