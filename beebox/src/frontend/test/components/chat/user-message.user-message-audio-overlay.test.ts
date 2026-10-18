// # User message display: audio-review overlay badges
//
// `UserMessage` (`components/chat/user-message.tsx`) overlays a retranscription
// or audio-consult report onto a user's bubble
// (docs/implemented-plans/retranscription-in-chat.md Track 3): the swapped text reaches
// `UserMessageText`, the original stays recoverable in the badge's popover
// content, and the popover never opens by default — so these tests render the
// badge cluster's pure spec-building seam (`buildAudioBadgeSpecs`) directly for
// label/popover-content checks, alongside a full `UserMessage` static render
// for badge presence and the text swap.

import { test } from "tap";
import "agent-doctest/tap";
import { printed } from "agent-doctest/check";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { UserMessage } from "../../../src/components/chat/user-message/view.js";
import { originalDisplayText } from "../../../src/components/chat/user-message/user-entry-content.js";
import { buildAudioBadgeSpecs } from "../../../src/components/chat/user-message/audio-overlay-badge.js";
import { resolveEntryMessageId, resolveTranscriptionProvenance } from "../../../src/components/chat/message-parsing.js";
import { createAudioOverlayStore } from "../../../src/components/chat/audio-overlay-store.js";
import type { SessionEntry } from "../../../src/api.js";

globalThis.React = React;

function voiceEntry(messageId: string, text: string): SessionEntry {
  return {
    uuid: "sdk-uuid-1",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text: `<speech stt="deepgram" message-id="${messageId}">${text}</speech>` }],
  };
}

function hqVoiceEntry(messageId: string, text: string): SessionEntry {
  return {
    ...voiceEntry(messageId, text),
    content: [{ type: "text", text: `<chat-app hq-dictation="on">\n<card-activity ref="_content/example.card">viewed</card-activity>\n</chat-app>\n<speech stt="hq" stt-service="whisper-llm" message-id="${messageId}">${text}</speech>` }],
  };
}

function render(entries: SessionEntry[], audioOverlayStore?: ReturnType<typeof createAudioOverlayStore>): string {
  return renderToStaticMarkup(React.createElement(UserMessage, { entries, audioOverlayStore }));
}

function otherUserVoiceEntry(messageId: string, text: string): SessionEntry {
  return {
    uuid: "sdk-uuid-bob",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    user: "Bob",
    userEmail: "bob@example.com",
    content: [{ type: "text", text: `<speech stt="deepgram" message-id="${messageId}">${text}</speech>` }],
  };
}

/** Renders as viewed by a DIFFERENT user (Alice) than the message's sender (Bob). */
function renderAsOtherViewer(entries: SessionEntry[], audioOverlayStore?: ReturnType<typeof createAudioOverlayStore>): string {
  return renderToStaticMarkup(React.createElement(UserMessage, {
    entries, audioOverlayStore, currentUserEmail: "alice@example.com", currentUserName: "Alice",
  }));
}

// ## Retranscription: label includes the resolved service
void test("Retranscription: label includes the resolved service", async (t) => {
  // doctest:L66
  const specs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
    "two large legs",
  );
  t.check(specs.map((s) => s.label).join(", "), "Retranscribed — deepgram-hq");

  // ## Retranscription popover content: the ORIGINAL bubble text, never the overlay
  //
  // Chained (`continue`) onto the previous block so `specs` is still in scope.

  // doctest:L79
  const popover = renderToStaticMarkup(specs[0]?.detail);
  await t.checkText(popover.includes("two large legs"), "true");

  // doctest:L83
  await t.checkText(popover.includes("two large eggs"), "false");

  // doctest:L86
  await t.checkText(popover.includes("realtime transcript"), "true");
});

// ## Retranscription: no service known → label omits the placeholder
void test("Retranscription: no service known → label omits the placeholder", async (t) => {
  // doctest:L93
  const noServiceSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", diarized: false } },
    "two large legs",
  );
  t.check(noServiceSpecs.map((s) => s.label).join(", "), "Retranscribed");
});

// ## Consulted: fixed label; detail carries the question(s) asked
void test("Consulted: fixed label; detail carries the question(s) asked", async (t) => {
  const out = printed();
  const print = out.print;
  // doctest:L104
  const consultedSpecs = buildAudioBadgeSpecs({ consulted: { questions: ["did I sound annoyed?"] } }, "irrelevant");
  await t.checkText(out.with(consultedSpecs.map((s) => s.label).join(", ")), "This recording was analyzed");

  // doctest:L108
  const detailHtml = renderToStaticMarkup(consultedSpecs[0]?.detail);
  print(`heading: ${detailHtml.includes("question asked")}`);
  await t.checkText(out.with(print(`question: ${detailHtml.includes("did I sound annoyed?")}`)), `heading: true
question: true`);

  // doctest:L115
  const multi = buildAudioBadgeSpecs({ consulted: { questions: ["q one?", "q two?"] } }, "x");
  await t.checkText(out.with(renderToStaticMarkup(multi[0]?.detail).includes("questions asked")), "true");
});

// ## Both present: retranscription badge first, consulted appended after
void test("Both present: retranscription badge first, consulted appended after", async (t) => {
  // doctest:L123
  const bothSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "x", diarized: false }, consulted: { questions: ["did I sound annoyed?"] } },
    "y",
  );
  t.check(bothSpecs.map((s) => s.kind).join(", "), "retranscribed, consulted");
});

// ## Full render: no overlay store → no badge, original text shown
void test("Full render: no overlay store → no badge, original text shown", async (t) => {
  // doctest:L134
  const plainOut = render([voiceEntry("msg-1", "two large legs")]);
  await t.checkText(plainOut.includes("two large legs"), "true");

  // doctest:L138
  await t.checkText(plainOut.includes("aria-haspopup"), "false");
});

// ## Durable HQ provenance renders a subtle badge from history
//
// The service comes from the persisted speech wrapper, which the client stamps
// only from a successful server response. Reloading history therefore retains
// the evidence without relying on the transient retranscription overlay store.
void test("The service comes from the persisted speech wrapper, which the client stamps...", async (t) => {
  // doctest:L149
  const hqEntry = hqVoiceEntry("msg-hq", "server corrected words");
  t.check(resolveTranscriptionProvenance(hqEntry), {
    kind: "hq",
    service: "whisper-llm",
  });

  // doctest:L153
  t.check(resolveEntryMessageId(hqEntry), "msg-hq");

  // doctest:L156
  const hqOut = render([hqEntry]);
  await t.checkText(hqOut.includes('aria-label="HQ transcript — whisper-llm"'), "true");

  // doctest:L160
  await t.checkText(render([voiceEntry("msg-realtime", "fast words")]).includes('aria-label="HQ transcript'), "false");
});

// Current messages mark the exception instead (docs/plans/hq-always.md): HQ
// text carries only `stt-service`, and live text carries `stt="live"`, which
// renders the live-text status line. The legacy wrappers above still read the
// same way.
void test("Current messages mark the exception instead (docs/plans/hq-always.md):", async (t) => {
  // doctest:L170
  function wrapped(attrs: string, id: string): SessionEntry {
    return { uuid: id, type: "user", timestamp: "2026-10-09T12:00:00Z", content: [{ type: "text", text: `<speech ${attrs} message-id="${id}">words</speech>` }] };
  }
  const currentHq = wrapped('stt-service="apple-speech-transcriber"', "msg-cur-hq");
  const currentLive = wrapped('stt="live"', "msg-cur-live");
  t.check([resolveTranscriptionProvenance(currentHq), resolveTranscriptionProvenance(currentLive)], [
    {
      kind: "hq",
      service: "apple-speech-transcriber",
    },
    {
      kind: "realtime",
    },
  ]);

  // doctest:L178
  await t.checkText(render([currentLive]).includes("Live text — HQ transcript unavailable"), "true");

  // doctest:L181
  await t.checkText(render([currentHq]).includes("Live text — HQ transcript unavailable"), "false");
});

// ## Full render: a matching retranscription swaps the displayed text and shows a badge
void test("Full render: a matching retranscription swaps the displayed text and shows a badge", async (t) => {
  // doctest:L188
  const store = createAudioOverlayStore();
  store.applyRetranscription("msg-2", { newText: "two large eggs", service: "deepgram-hq", diarized: false });
  const swappedOut = render([voiceEntry("msg-2", "two large legs")], store);
  await t.checkText(swappedOut.includes("two large eggs"), "true");

  // doctest:L194
  await t.checkText(swappedOut.includes('aria-label="Retranscribed — deepgram-hq"'), "true");
});

// ## Full render: no matching overlay entry for this message → original text, no badge
//
// An overlay for a DIFFERENT message id sitting in the same store must not
// leak onto an unrelated bubble.
void test("An overlay for a DIFFERENT message id sitting in the same store must not leak...", async (t) => {
  // doctest:L204
  const otherStore = createAudioOverlayStore();
  otherStore.applyRetranscription("msg-other", { newText: "not this bubble", diarized: false });
  const untouchedOut = render([voiceEntry("msg-3", "two large legs")], otherStore);
  await t.checkText(untouchedOut.includes("two large legs"), "true");

  // doctest:L210
  await t.checkText(untouchedOut.includes("not this bubble"), "false");

  // doctest:L213
  await t.checkText(untouchedOut.includes("aria-haspopup"), "false");
});

// ## Full render: consulted-only overlay → badge present, text unchanged
void test("Full render: consulted-only overlay → badge present, text unchanged", async (t) => {
  // doctest:L220
  const consultedStore = createAudioOverlayStore();
  consultedStore.applyConsulted("msg-4", "did I sound annoyed?");
  const consultedOut = render([voiceEntry("msg-4", "two large legs")], consultedStore);
  await t.checkText(consultedOut.includes("two large legs"), "true");

  // doctest:L226
  await t.checkText(consultedOut.includes('aria-label="This recording was analyzed"'), "true");
});

// ## Fix (cross-model review): another user's bubble ALSO overlays — not just the sender's own
//
// In a shared session, Bob's retranscribed message must update on a different
// viewer's (Alice's) screen too — the overlay isn't scoped to who's looking.
void test("In a shared session, Bob's retranscribed message must update on a different v...", async (t) => {
  // doctest:L236
  const otherStore = createAudioOverlayStore();
  otherStore.applyRetranscription("msg-bob-1", { newText: "corrected bob text", service: "deepgram-hq", diarized: false });
  const otherOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-1", "original bob text")], otherStore);
  await t.checkText(otherOut.includes("corrected bob text"), "true");

  // doctest:L242
  await t.checkText(otherOut.includes("original bob text"), "false");

  // doctest:L245
  await t.checkText(otherOut.includes('aria-label="Retranscribed — deepgram-hq"'), "true");
});

// ## Fix (cross-model review): another user's bubble also shows the consulted badge
void test("Fix (cross-model review): another user's bubble also shows the consulted badge", async (t) => {
  // doctest:L252
  const otherConsultedStore = createAudioOverlayStore();
  otherConsultedStore.applyConsulted("msg-bob-2", "was that sarcasm?");
  const otherConsultedOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-2", "bob asked something")], otherConsultedStore);
  await t.checkText(otherConsultedOut.includes("bob asked something"), "true");

  // doctest:L258
  await t.checkText(otherConsultedOut.includes('aria-label="This recording was analyzed"'), "true");
});

// ## Fix (P4): `originalDisplayText` unwraps `<unsure>` marks to plain words
//
// `originalDisplayText` (`user-entry-content.tsx`) feeds the popover's
// "realtime transcript" body — it must read as clean text, not leak the
// agent-facing `<unsure>` tag the normal bubble path styles instead (same
// unwrap `stripSpeechWrappers` does backend-side).
void test("originalDisplayText (user-entry-content.tsx) feeds the popover's \"realtime tr...", async (t) => {
  // doctest:L270
  const unsureEntry: SessionEntry = {
    uuid: "sdk-uuid-unsure",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text: '<speech stt="deepgram" message-id="msg-5">they\'re all <unsure>cloud</unsure> code in different ways</speech>' }],
  };
  t.check(originalDisplayText(unsureEntry), "they're all cloud code in different ways");

  // The popover content itself renders the clean, unwrapped text — never the raw tag:

  // doctest:L283
  const unsureSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
    originalDisplayText(unsureEntry),
  );
  const unsurePopover = renderToStaticMarkup(unsureSpecs[0]?.detail);
  await t.checkText(
    // React-escapes the apostrophe in static markup, so match the unwrapped
    // word's surroundings rather than the raw contraction.
    unsurePopover.includes("all cloud code in different ways"),
    "true",
  );

  // doctest:L293
  await t.checkText(unsurePopover.includes("<unsure"), "false");

  // doctest:L296
  await t.checkText(unsurePopover.includes("</unsure>"), "false");
});
