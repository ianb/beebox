// # Voice chip face
//
// `VoiceChipFace` (`components/chat/VoiceChip.tsx`) is the presentational half of
// the app bar's voice chip — renderable standalone, without the `Dropdown` or
// router context the full `VoiceChip` needs.
//
// One drawing shares a single bot between two **orthogonal** facts:
//
// - **Who holds the floor** (the arrows) — taking turns, or you narrating while
//   the box listens. Podcast, the box holding the floor, is the third value of the
//   same axis and is not built.
// - **How the box answers** (marks beside the bot) — aloud, or in writing.
//
// Both are shown because neither implies the other: in narration the box is silent
// by default but may still speak by exception — when asked, or when the boxholder
// is hands-busy (`NARRATION_OVERLAY`) — and answering in text removes that
// exception, so a genuine question arrives as a callout instead.
//
// The four marks sat in a 50×16 box at 1:1 until 2026-09-20, which gave each one
// about 8px under a 1.3px stroke — legible on a desktop, three unrelated glyphs on
// a phone (`issues/bugs/2026-09-15-mobile-app-bar-crowds-place-label.md`). Most of
// that width was the space between the marks, not the marks, so closing it and
// rendering the 41-unit box at 51px made every mark a quarter bigger and handed
// the app bar 7px back. A reduced two-mark face was tried first and rejected:
// shrink the spacing before the vocabulary.
//
// This replaced a microphone dimmed to 40% when narration was off. A mic cannot
// carry the distinction (voice input uses the mic in both modes), and the deeper
// reason is that narration is a *relationship*: it changes what the box does as
// much as what you do, and no single-participant picture shows a relationship
// (`issues/closed/bugs/2026-08-06-narration-mode-icon-ambiguous-with-mic.md`).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceChipFace, voiceChipDiarizationEnabled, type VoiceChipFaceState } from "../../../../src/components/chat/VoiceChip/view.js";
import { voiceChipLabel } from "../../../../src/components/chat/VoiceChip/voice-chip-label.js";

globalThis.React = React;

function renderFace(state: VoiceChipFaceState) {
  return renderToStaticMarkup(React.createElement(VoiceChipFace, state));
}

// ## Taking turns, answering aloud
void test("Taking turns, answering aloud", async (t) => {
  const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
  t.check(face, "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>");
});

// ## The box answers in writing
//
// Written lines, not a slashed speaker: a slash says *suppressed*, and that is not
// what happens — the box still answers, in text.
void test("Written lines, not a slashed speaker:", async (t) => {
  const face = renderFace({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
  t.check(face, "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"true\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M30 4h10M30 8h7M30 12h10\"></path></svg></span>");
});

// ## You hold the floor
void test("You hold the floor", async (t) => {
  const face = renderFace({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false });
  t.check(face, "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"true\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>");
});

// ## The two axes combine, and the name says both in words
//
// The glyphs carry it with participants, arrows, and output marks; the accessible name says it outright,
// because a relationship and a channel do not survive being read as a list of
// toggle names.
void test("The glyphs carry it with participants, arrows, and output marks; the accessib...", async (t) => {
  t.check(
    [
      voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false }),
      voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false }),
      voiceChipLabel({ muted: false, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false }),
      voiceChipLabel({ muted: true, narrationEnabled: true, hqInFlight: false, diarizationEnabled: false }),
    ],
    [
    "Voice — taking turns, answers aloud",
    "Voice — taking turns, answers in text",
    "Voice — you are narrating, it listens, answers aloud",
    "Voice — you are narrating, it listens, answers in text",
  ],
  );
});

// ## HQ transcription in flight keeps its readable label
//
// The word is worth about 70px, which at phone width is most of the place label,
// so it appears only from `sm:` up. Below that the same fact is a pulse, and the
// accessible name says it at every width.
void test("The word is worth about 70px, which at phone width is most of the place label...", async (t) => {
  const face = renderFace({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false });
  t.check(face, "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg><span aria-hidden=\"true\" class=\"sm:hidden w-1.5 h-1.5 rounded-full bg-current animate-pulse\"></span><span class=\"hidden sm:inline text-xs\">transcribing…</span></span>");

  const idle = renderFace({ muted: false, narrationEnabled: false, hqInFlight: false, diarizationEnabled: false });
  t.check(idle, "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>");

  t.check(voiceChipLabel({ muted: false, narrationEnabled: false, hqInFlight: true, diarizationEnabled: false }), "Voice — taking turns, answers aloud, transcribing");
});

// ## Diarization changes people, not the floor or answer channel
//
// Every dictated message gets the HQ pass (docs/plans/hq-always.md), so the
// chip shows speaker labels exactly when the box's HQ service diarizes.
void test("Every dictated message gets the HQ pass (docs/plans/hq-always.md), so the chi...", async (t) => {
  const services: Parameters<typeof voiceChipDiarizationEnabled>[0][] = ["voxtral-diarized", "mai-diarized", "voxtral", "mai", "whisper", "whisper-llm", "whisper-llm-mini", null];
  t.check(services.map(voiceChipDiarizationEnabled), [
    true,
    true,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});

// The group works with both arrow states and both channels. Each face still has
// exactly one bot and one SVG; only the human head count changes.
void test("The group works with both arrow states and both channels.", async (t) => {
  const combinations = [false, true].flatMap(diarizationEnabled => [false, true].flatMap(narrationEnabled => [false, true].map(muted => {
    return renderFace({ muted, narrationEnabled, diarizationEnabled, hqInFlight: false });
  })));
  t.check(combinations, [
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"true\" data-voice-narration=\"false\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M30 4h10M30 8h7M30 12h10\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"true\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"true\" data-voice-narration=\"true\" data-voice-diarization=\"false\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><path d=\"M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M30 4h10M30 8h7M30 12h10\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"false\" data-voice-diarization=\"true\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><g transform=\"translate(0 2) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><g transform=\"translate(4.5 -1) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"true\" data-voice-narration=\"false\" data-voice-diarization=\"true\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><g transform=\"translate(0 2) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><g transform=\"translate(4.5 -1) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g></g><path d=\"M10 5h6l-2-2M16 11h-6l2 2\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M30 4h10M30 8h7M30 12h10\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"false\" data-voice-narration=\"true\" data-voice-diarization=\"true\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><g transform=\"translate(0 2) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><g transform=\"translate(4.5 -1) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g></g><path d=\"M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M31.5 6a3 3 0 0 1 0 4M35 3.5a6.5 6.5 0 0 1 0 9\"></path></svg></span>",
    "<span class=\"inline-flex items-center gap-1.5\" data-voice-muted=\"true\" data-voice-narration=\"true\" data-voice-diarization=\"true\"><svg class=\"w-[51px] h-5 shrink-0\" viewBox=\"0 0 41 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><g transform=\"translate(0 1)\"><g transform=\"translate(0 2) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g><g transform=\"translate(4.5 -1) scale(.7)\"><circle cx=\"4.5\" cy=\"5\" r=\"2.2\"></circle><path d=\"M1 13v-1.5a3.5 3.5 0 0 1 7 0V13\"></path></g></g><path d=\"M10 8h6m-2.5-2.5 2.5 2.5-2.5 2.5\"></path><g transform=\"translate(19 1)\"><path d=\"M4.5 3V1.5M3 1.5h3\"></path><rect x=\".8\" y=\"4\" width=\"7.4\" height=\"8\" rx=\"1.5\"></rect><path d=\"M3 9.8h3\"></path><circle cx=\"3\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle><circle cx=\"6\" cy=\"7\" r=\".65\" fill=\"currentColor\" stroke=\"none\"></circle></g><path d=\"M30 4h10M30 8h7M30 12h10\"></path></svg></span>",
  ]);

  t.check(voiceChipLabel({ muted: true, narrationEnabled: false, hqInFlight: false, diarizationEnabled: true }), "Voice — taking turns, answers in text, speaker labels on");
});
