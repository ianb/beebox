// # Audio-review overlay: resolution, store, session filtering
//
// Track 3 of `docs/implemented-plans/retranscription-in-chat.md`: the frontend overlay a
// `bbx chat retranscribe` / `ask-about-audio` report paints onto the user's
// bubble. This covers the pure seams — entry-to-key resolution
// (`resolveEntryMessageId`, `message-parsing.ts`), the overlay store
// (`audio-overlay-store.ts`), and the event-handler session filter
// (`matchesOwnSession`, `InteractiveChat-ws.ts`) — rather than mounting the WS
// machinery.

import { test } from "tap";
import "agent-doctest/tap";
import { resolveEntryMessageId } from "../../src/components/chat/message-parsing.js";
import { createAudioOverlayStore } from "../../src/components/chat/audio-overlay-store.js";
import { matchesOwnSession } from "../../src/components/chat/everywhere/InteractiveChat/ws.js";
import type { SessionEntry } from "../../src/api.js";

function userEntry(uuid: string, text: string): SessionEntry {
  return { uuid, type: "user", timestamp: "2026-01-01T00:00:00Z", content: [{ type: "text", text }] };
}

// ## Entry resolution: `message-id="…"` attribute wins when present
//
// The authoritative (post-swap) entry carries the attribute `chat-assemble.ts`
// stamps on the `<speech>` wrapper — resolution reads it regardless of the
// entry's own `uuid`.
void test("The authoritative (post-swap) entry carries the attribute chat-assemble.ts st...", async (t) => {
  // doctest:L29
  const entry = userEntry("sdk-uuid-1", '<speech stt="deepgram" message-id="msg-abc123">two eggs</speech>');
  t.check(resolveEntryMessageId(entry), "msg-abc123");
});

// ## No attribute (pending optimistic stub) → falls back to the entry's own uuid
//
// Before the server round-trip, the pending bubble's raw text has no wrapper
// attribute yet — `chat-actions.ts` builds it with `uuid: event.messageId`, so
// falling back to `entry.uuid` recovers the same key.
void test("Before the server round-trip, the pending bubble's raw text has no wrapper at...", async (t) => {
  // doctest:L41
  const pending = userEntry("msg-abc123", "two eggs");
  t.check(resolveEntryMessageId(pending), "msg-abc123");
});

// ## Re-resolves across the pending→authoritative swap without special-casing
//
// The same logical message resolves to the same key before and after
// `reconcilePending` swaps in the server entry — the pending stub via the uuid
// fallback, the authoritative entry via the attribute.
void test("The same logical message resolves to the same key before and after reconcileP...", async (t) => {
  // doctest:L53
  const beforeSwap = userEntry("msg-xyz789", "two eggs");
  const afterSwap = userEntry("sdk-uuid-2", '<speech message-id="msg-xyz789">two eggs</speech>');
  t.check(resolveEntryMessageId(beforeSwap), resolveEntryMessageId(afterSwap));
});

// ## A `message-id="…"` string TYPED into the message body does NOT resolve (fix, cross-model review)
//
// The match is anchored to the `<speech>` wrapper's own opening tag — a user
// who types the literal text `message-id="msg-real"` into their message (inside
// a `<typed>` wrapper, or even inside a `<speech>` wrapper's BODY, after the
// opening tag) must not bind that bubble to another message's overlay.
void test("The match is anchored to the <speech> wrapper's own opening tag — a user who...", async (t) => {
  // doctest:L67
  const typedLookalike = userEntry("uuid-typed-2", '<typed>my message-id="msg-real" is fake</typed>');
  t.check(resolveEntryMessageId(typedLookalike), "uuid-typed-2");

  // doctest:L73
  const bodyLookalike = userEntry("sdk-uuid-3", '<speech stt="deepgram">quote: message-id="msg-real"</speech>');
  t.check(resolveEntryMessageId(bodyLookalike), "sdk-uuid-3");

  // The genuine wrapper attribute — even with other attributes before it, and
  // even when the body separately contains the same literal substring — still
  // resolves correctly:

  // doctest:L83
  const genuineWithLookalikeBody = userEntry(
    "sdk-uuid-4",
    '<speech stt="deepgram" message-id="msg-real" diarized="0">quote: message-id="msg-fake-in-body"</speech>',
  );
  t.check(resolveEntryMessageId(genuineWithLookalikeBody), "msg-real");
});

// ## Overlay store: a later retranscription overwrites the earlier one
void test("Overlay store: a later retranscription overwrites the earlier one", async (t) => {
  // doctest:L94
  const store = createAudioOverlayStore();
  store.applyRetranscription("msg-1", { newText: "first pass", diarized: false });
  store.applyRetranscription("msg-1", { newText: "second pass", service: "deepgram-hq", diarized: false });
  t.check(store.getEntry("msg-1"), {
    retranscription: {
      newText: "second pass",
      service: "deepgram-hq",
      diarized: false,
    },
  });
});

// ## Overlay store: consults accumulate questions; identical re-asks dedupe
void test("Overlay store: consults accumulate questions; identical re-asks dedupe", async (t) => {
  const consultStore = createAudioOverlayStore();
  let notifyCount = 0;
  consultStore.subscribe("msg-2", () => { notifyCount += 1; });
  consultStore.applyConsulted("msg-2", "did I say can or cannot?");
  consultStore.applyConsulted("msg-2", "did I say can or cannot?");
  consultStore.applyConsulted("msg-2", "how did I pronounce Ostrowski?");
  t.check(consultStore.getEntry("msg-2"), {
    consulted: { questions: ["did I say can or cannot?", "how did I pronounce Ostrowski?"] },
  });
  t.check(notifyCount, 3);
});

// ## Overlay store: subscriptions are keyed — an unrelated message never notifies
void test("Overlay store: subscriptions are keyed — an unrelated message never notifies", async (t) => {
  // doctest:L127
  const keyedStore = createAudioOverlayStore();
  let otherNotified = false;
  keyedStore.subscribe("msg-not-this-one", () => { otherNotified = true; });
  keyedStore.applyRetranscription("msg-target", { newText: "hi", diarized: false });
  t.check(otherNotified, false);
});

// ## Overlay store: retranscription and consulted coexist on the same entry
//
// Both a retranscribe report and a later ask-about-audio report can land on the
// same message.
void test("Both a retranscribe report and a later ask-about-audio report can land on the...", async (t) => {
  // doctest:L141
  const bothStore = createAudioOverlayStore();
  bothStore.applyRetranscription("msg-3", { newText: "corrected text", diarized: false });
  bothStore.applyConsulted("msg-3", "background noise?");
  t.check(bothStore.getEntry("msg-3"), {
    retranscription: {
      newText: "corrected text",
      diarized: false,
    },
    consulted: {
      questions: [
        "background noise?",
      ],
    },
  });
});

// ## Session filtering: own session assigned and matching → applies
void test("Session filtering: own session assigned and matching → applies", async (t) => {
  // doctest:L162
  t.check(matchesOwnSession("session-a", "session-a"), true);
});

// ## Session filtering: own session assigned but mismatched → ignored
//
// A stale/foreign tab's session id never matches another session's report.
void test("A stale/foreign tab's session id never matches another session's report.", async (t) => {
  // doctest:L171
  t.check(matchesOwnSession("session-a", "session-b"), false);
});

// ## Session filtering: own session not yet assigned (null) → ignored
//
// Unlike the broadcast `forSession` helper (null-permissive by design for
// box-wide events), a point-to-point audio-review report has exactly one
// intended tab — a tab with no session yet can't be it.
void test("Unlike the broadcast forSession helper (null-permissive by design for box-wid...", async (t) => {
  // doctest:L182
  t.check(matchesOwnSession(null, "session-a"), false);
});
