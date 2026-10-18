// # Speech progress indicators
//
// Each spoken chunk uses its existing left border as a compact progress
// indicator. The states differ by border style as well as semantic color, and a
// screen-reader description prevents color from being the only signal.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SpeechChunk } from "../../../src/components/chat/SpeechChunk.js";
import type { SpeechSegmentState } from "../../../src/machines/speech-segment-states.js";

globalThis.React = React;

function render(state: SpeechSegmentState): string {
  return renderToStaticMarkup(
    React.createElement(SpeechChunk, { state, children: "Spoken words" }),
  );
}

// ## Waiting for generated audio
void test("Waiting for generated audio", async (t) => {
  // doctest:L25
  const waiting = render("waiting");
  await t.checkText(waiting.includes('data-speech-state="waiting"'), "true");

  // doctest:L29
  await t.checkText(waiting.includes("border-dashed"), "true");

  // doctest:L32
  await t.checkText(waiting.includes("Speech audio is being prepared."), "true");
});

// ## Playing audio
void test("Playing audio", async (t) => {
  // doctest:L39
  const playing = render("playing");
  await t.checkText(playing.includes('data-speech-state="playing"'), "true");

  // doctest:L43
  await t.checkText(playing.includes("border-primary"), "true");

  // doctest:L46
  await t.checkText(playing.includes("Speech audio is playing."), "true");
});

// ## Sticky failure
void test("Sticky failure", async (t) => {
  // doctest:L53
  const failed = render("failed");
  await t.checkText(failed.includes('data-speech-state="failed"'), "true");

  // doctest:L57
  await t.checkText(failed.includes("border-double"), "true");

  // doctest:L60
  await t.checkText(failed.includes("Speech audio failed."), "true");
});

// ## A failure says why
//
// A failed chunk shows the reason the playback machine recorded — for a rate
// limit, the provider's own message — so the boxholder sees "Free Tier" or a
// missing key where they noticed the silence. The reason shows only while the
// chunk is failed.
void test("A failed chunk shows the reason the playback machine recorded — for a rate li...", async (t) => {
  // doctest:L72
  const why = "TTS backend answered 429 Too Many Requests: Rate limit exceeded (limit: 10 requests per day on Free Tier)";
  const explained = renderToStaticMarkup(React.createElement(SpeechChunk, { state: "failed", failureReason: why, children: "Spoken words" }));
  await t.checkText(explained.includes(`Speech failed: ${why}`), "true");

  // doctest:L77
  const recovered = renderToStaticMarkup(React.createElement(SpeechChunk, { state: "playing", failureReason: why, children: "Spoken words" }));
  await t.checkText(recovered.includes("Speech failed"), "false");
});
