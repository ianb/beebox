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
  t.check(render("waiting"), "<div data-speech-state=\"waiting\" class=\"border-l-2 pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out border-warning border-dashed bg-warning/5\"><span class=\"sr-only\">Speech audio is being prepared.</span>Spoken words</div>");
});

// ## Playing audio
void test("Playing audio", async (t) => {
  t.check(render("playing"), "<div data-speech-state=\"playing\" class=\"border-l-2 pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out border-primary border-solid bg-white/25\"><span class=\"sr-only\">Speech audio is playing.</span>Spoken words</div>");
});

// ## Sticky failure
void test("Sticky failure", async (t) => {
  t.check(render("failed"), "<div data-speech-state=\"failed\" class=\"pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out border-l-4 border-danger border-double bg-danger/5\"><span class=\"sr-only\">Speech audio failed.</span>Spoken words</div>");
});

// ## A failure says why
//
// A failed chunk shows the reason the playback machine recorded — for a rate
// limit, the provider's own message — so the boxholder sees "Free Tier" or a
// missing key where they noticed the silence. The reason shows only while the
// chunk is failed.
void test("A failed chunk shows the reason the playback machine recorded — for a rate li...", async (t) => {
  const why = "TTS backend answered 429 Too Many Requests: Rate limit exceeded (limit: 10 requests per day on Free Tier)";
  t.check(renderToStaticMarkup(React.createElement(SpeechChunk, { state: "failed", failureReason: why, children: "Spoken words" })), "<div data-speech-state=\"failed\" class=\"pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out border-l-4 border-danger border-double bg-danger/5\"><span class=\"sr-only\">Speech audio failed.</span>Spoken words<p class=\"mt-1 text-xs text-danger\">Speech failed: TTS backend answered 429 Too Many Requests: Rate limit exceeded (limit: 10 requests per day on Free Tier)</p></div>");

  t.check(renderToStaticMarkup(React.createElement(SpeechChunk, { state: "playing", failureReason: why, children: "Spoken words" })), "<div data-speech-state=\"playing\" class=\"border-l-2 pl-3 pr-2 py-1 rounded-r-md transition-colors duration-500 ease-out border-primary border-solid bg-white/25\"><span class=\"sr-only\">Speech audio is playing.</span>Spoken words</div>");
});
