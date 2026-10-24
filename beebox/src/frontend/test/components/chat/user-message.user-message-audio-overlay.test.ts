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
import "@ianbicking/tap-check/tap";
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

const BADGE_CLASS = "inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-info text-white leading-none ring-1 ring-warm-50 cursor-pointer";
const RETRANSCRIBED_ICON = '<svg class="w-[13px] h-[13px]" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9a6 6 0 1 1 12 0c0 4.5-4 5-4 8.5a3 3 0 1 1-6 0"></path><path stroke-linecap="round" stroke-linejoin="round" d="M14.5 9a2.5 2.5 0 0 0-5 0"></path></svg>';
const CONSULTED_ICON = '<svg class="w-[13px] h-[13px]" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.8"><path stroke-linecap="round" stroke-linejoin="round" d="M4 11a5.5 5.5 0 1 1 11 0c0 4-3.5 4.5-3.5 7.5a2.8 2.8 0 1 1-5.6 0"></path></g><path fill="currentColor" d="M18.5 2l1.3 3.2L23 6.5l-3.2 1.3L18.5 11l-1.3-3.2L14 6.5l3.2-1.3z"></path></svg>';

/** The badge cluster `UserMessage` renders: empty, or one popover button. */
function badgeCluster(badge: { label: string; icon: string } | null): string {
  const button = badge === null
    ? ""
    : `<span class="inline-flex items-center gap-0.5"><span class="relative inline-flex"><button type="button" aria-label="${badge.label}" aria-haspopup="dialog" aria-expanded="false" class="${BADGE_CLASS}"><span aria-hidden="true" class="inline-flex">${badge.icon}</span></button></span></span>`;
  return `<span class="absolute -top-1 -left-1 inline-flex items-center gap-0.5">${button}</span>`;
}

const RETRANSCRIBED = { label: "Retranscribed — deepgram-hq", icon: RETRANSCRIBED_ICON };
const CONSULTED = { label: "This recording was analyzed", icon: CONSULTED_ICON };

/** The viewer's own bubble. `hq` is the HQ marker, `status` the live-text line. */
function ownBubble(parts: { badge: { label: string; icon: string } | null; hq: string; text: string; status: string }): string {
  return `<div class="flex justify-end pl-12 sm:pl-24 py-1"><div class="relative min-w-0">${badgeCluster(parts.badge)}<span class="absolute top-px right-px z-10">${parts.hq}</span><div class="bbx-chat-user-paper rounded-l-2xl bg-info text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] break-words"><div class="text-sm whitespace-pre-wrap">${parts.text}</div>${parts.status}</div></div></div>`;
}

/** Bob's bubble as Alice sees it. */
function bobBubble(parts: { badge: { label: string; icon: string } | null; text: string }): string {
  return `<div class="pr-12 sm:pr-24 py-1"><div class="bbx-chat-meta-material text-xs text-card-soft ml-3 sm:ml-6 mb-0.5">Bob</div><div class="relative ml-3 sm:ml-6 w-fit">${badgeCluster(parts.badge)}<span class="absolute top-px right-px z-10"></span><div class="rounded-r-2xl bg-primary text-white px-3 sm:px-4 py-2 min-w-[80px] sm:min-w-[120px] w-fit break-words"><div class="text-sm whitespace-pre-wrap">${parts.text}</div></div></div></div>`;
}

const hqMarker = (service: string): string =>
  `<span role="img" aria-label="HQ transcript — ${service}" title="HQ transcript — ${service}" class="text-white/40 text-[9px] font-medium leading-none tracking-wide">HQ</span>`;
const LIVE_STATUS = '<div role="status" class="bbx-chat-user-status text-xs mt-1 italic">Live text — HQ transcript unavailable</div>';

// ## Retranscription: label includes the resolved service
void test("Retranscription: label includes the resolved service", async (t) => {
  const specs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
    "two large legs",
  );
  t.check(specs.map((s) => s.label), ["Retranscribed — deepgram-hq"]);

  // The popover shows the ORIGINAL bubble text, never the overlay.
  t.check(renderToStaticMarkup(specs[0]?.detail), '<div class="text-warm-700 text-[10px] uppercase tracking-wide mt-1.5">realtime transcript</div><div class="mt-0.5 whitespace-pre-wrap">two large legs</div>');
});

// ## Retranscription: no service known → label omits the placeholder
void test("Retranscription: no service known → label omits the placeholder", async (t) => {
  const noServiceSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", diarized: false } },
    "two large legs",
  );
  t.check(noServiceSpecs.map((s) => s.label), ["Retranscribed"]);
});

// ## Consulted: fixed label; detail carries the question(s) asked
void test("Consulted: fixed label; detail carries the question(s) asked", async (t) => {
  const consultedSpecs = buildAudioBadgeSpecs({ consulted: { questions: ["did I sound annoyed?"] } }, "irrelevant");
  t.check(consultedSpecs.map((s) => s.label), ["This recording was analyzed"]);

  t.check(renderToStaticMarkup(consultedSpecs[0]?.detail), '<div class="text-warm-700 text-[10px] uppercase tracking-wide mt-1.5">question asked</div><div class="mt-0.5 whitespace-pre-wrap">did I sound annoyed?</div>');

  const multi = buildAudioBadgeSpecs({ consulted: { questions: ["q one?", "q two?"] } }, "x");
  t.check(renderToStaticMarkup(multi[0]?.detail), '<div class="text-warm-700 text-[10px] uppercase tracking-wide mt-1.5">questions asked</div><div class="mt-0.5 whitespace-pre-wrap">q one?</div><div class="mt-0.5 whitespace-pre-wrap">q two?</div>');
});

// ## Both present: retranscription badge first, consulted appended after
void test("Both present: retranscription badge first, consulted appended after", async (t) => {
  const bothSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "x", diarized: false }, consulted: { questions: ["did I sound annoyed?"] } },
    "y",
  );
  t.check(bothSpecs.map((s) => s.kind), ["retranscribed", "consulted"]);
});

// ## Full render: no overlay store → no badge, original text shown
void test("Full render: no overlay store → no badge, original text shown", async (t) => {
  const plainOut = render([voiceEntry("msg-1", "two large legs")]);
  t.check(plainOut, ownBubble({ badge: null, hq: "", text: "two large legs", status: "" }));
});

// ## Durable HQ provenance renders a subtle badge from history
//
// The service comes from the persisted speech wrapper, which the client stamps
// only from a successful server response. Reloading history therefore retains
// the evidence without relying on the transient retranscription overlay store.
void test("The service comes from the persisted speech wrapper, which the client stamps...", async (t) => {
  const hqEntry = hqVoiceEntry("msg-hq", "server corrected words");
  t.check(resolveTranscriptionProvenance(hqEntry), {
    kind: "hq",
    service: "whisper-llm",
  });

  t.check(resolveEntryMessageId(hqEntry), "msg-hq");

  const hqOut = render([hqEntry]);
  t.check(hqOut, ownBubble({ badge: null, hq: hqMarker("whisper-llm"), text: "server corrected words", status: "" }));

  t.check(render([voiceEntry("msg-realtime", "fast words")]), ownBubble({ badge: null, hq: "", text: "fast words", status: "" }));
});

// Current messages mark the exception instead (docs/plans/hq-always.md): HQ
// text carries only `stt-service`, and live text carries `stt="live"`, which
// renders the live-text status line. The legacy wrappers above still read the
// same way.
void test("Current messages mark the exception instead (docs/plans/hq-always.md):", async (t) => {
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

  t.check(render([currentLive]), ownBubble({ badge: null, hq: "", text: "words", status: LIVE_STATUS }));

  t.check(render([currentHq]), ownBubble({ badge: null, hq: hqMarker("apple-speech-transcriber"), text: "words", status: "" }));
});

// ## Full render: a matching retranscription swaps the displayed text and shows a badge
void test("Full render: a matching retranscription swaps the displayed text and shows a badge", async (t) => {
  const store = createAudioOverlayStore();
  store.applyRetranscription("msg-2", { newText: "two large eggs", service: "deepgram-hq", diarized: false });
  const swappedOut = render([voiceEntry("msg-2", "two large legs")], store);
  t.check(swappedOut, ownBubble({ badge: RETRANSCRIBED, hq: "", text: "two large eggs", status: "" }));
});

// ## Full render: no matching overlay entry for this message → original text, no badge
//
// An overlay for a DIFFERENT message id sitting in the same store must not
// leak onto an unrelated bubble.
void test("An overlay for a DIFFERENT message id sitting in the same store must not leak...", async (t) => {
  const otherStore = createAudioOverlayStore();
  otherStore.applyRetranscription("msg-other", { newText: "not this bubble", diarized: false });
  const untouchedOut = render([voiceEntry("msg-3", "two large legs")], otherStore);
  t.check(untouchedOut, ownBubble({ badge: null, hq: "", text: "two large legs", status: "" }));
});

// ## Full render: consulted-only overlay → badge present, text unchanged
void test("Full render: consulted-only overlay → badge present, text unchanged", async (t) => {
  const consultedStore = createAudioOverlayStore();
  consultedStore.applyConsulted("msg-4", "did I sound annoyed?");
  const consultedOut = render([voiceEntry("msg-4", "two large legs")], consultedStore);
  t.check(consultedOut, ownBubble({ badge: CONSULTED, hq: "", text: "two large legs", status: "" }));
});

// ## Fix (cross-model review): another user's bubble ALSO overlays — not just the sender's own
//
// In a shared session, Bob's retranscribed message must update on a different
// viewer's (Alice's) screen too — the overlay isn't scoped to who's looking.
void test("In a shared session, Bob's retranscribed message must update on a different v...", async (t) => {
  const otherStore = createAudioOverlayStore();
  otherStore.applyRetranscription("msg-bob-1", { newText: "corrected bob text", service: "deepgram-hq", diarized: false });
  const otherOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-1", "original bob text")], otherStore);
  t.check(otherOut, bobBubble({ badge: RETRANSCRIBED, text: "corrected bob text" }));
});

// ## Fix (cross-model review): another user's bubble also shows the consulted badge
void test("Fix (cross-model review): another user's bubble also shows the consulted badge", async (t) => {
  const otherConsultedStore = createAudioOverlayStore();
  otherConsultedStore.applyConsulted("msg-bob-2", "was that sarcasm?");
  const otherConsultedOut = renderAsOtherViewer([otherUserVoiceEntry("msg-bob-2", "bob asked something")], otherConsultedStore);
  t.check(otherConsultedOut, bobBubble({ badge: CONSULTED, text: "bob asked something" }));
});

// ## Fix (P4): `originalDisplayText` unwraps `<unsure>` marks to plain words
//
// `originalDisplayText` (`user-entry-content.tsx`) feeds the popover's
// "realtime transcript" body — it must read as clean text, not leak the
// agent-facing `<unsure>` tag the normal bubble path styles instead (same
// unwrap `stripSpeechWrappers` does backend-side).
void test("originalDisplayText (user-entry-content.tsx) feeds the popover's \"realtime tr...", async (t) => {
  const unsureEntry: SessionEntry = {
    uuid: "sdk-uuid-unsure",
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    content: [{ type: "text", text: '<speech stt="deepgram" message-id="msg-5">they\'re all <unsure>cloud</unsure> code in different ways</speech>' }],
  };
  t.check(originalDisplayText(unsureEntry), "they're all cloud code in different ways");

  // The popover content itself renders the clean, unwrapped text, never the raw tag.
  const unsureSpecs = buildAudioBadgeSpecs(
    { retranscription: { newText: "two large eggs", service: "deepgram-hq", diarized: false } },
    originalDisplayText(unsureEntry),
  );
  const unsurePopover = renderToStaticMarkup(unsureSpecs[0]?.detail);
  // React escapes the apostrophe in static markup.
  t.check(unsurePopover, '<div class="text-warm-700 text-[10px] uppercase tracking-wide mt-1.5">realtime transcript</div><div class="mt-0.5 whitespace-pre-wrap">they&#x27;re all cloud code in different ways</div>');
});
