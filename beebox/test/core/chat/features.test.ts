// # Chat Features Registry
//
// The control plane for chat-feature flags lives in `src/core/chat/features.ts`.
// It owns the closed registry of recognized feature names, validates values
// against each feature's allowed set, composes the `<chat-app>` snapshot
// the server prepends to user messages, and parses agent-emitted
// `<chat-app>` mutation tags out of assistant responses.
//
// See `docs/plans/narration-mode.md` for the bigger picture; this file
// covers the registry primitives.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import {
  composeChatAppSnapshot,
  mergeSeedFeatures,
  parseChatAppDeltas,
  resolveFeatures,
} from "../../../src/core/chat/features.js";

// Several assertions deliberately pass bogus inputs to exercise the warn-and-
// skip path. The console.warn fires are documented behavior; silence them
// here so they don't pollute test output.
console.warn = () => {};

// ## Defaults
//
// `resolveFeatures()` merges stored values over defaults, dropping
// unknown keys and invalid values silently (with a console warning the
// caller can ignore).
void test("resolveFeatures() merges stored values over defaults, dropping unknown keys a...", async (t) => {
  t.check(resolveFeatures(), {
    narration: "off",
    prose: "on",
  });

  t.check(resolveFeatures({ narration: "on" }), {
    narration: "on",
    prose: "on",
  });

  t.check(resolveFeatures({ narration: "on", bogus: "yes", prose: "wrong" }), {
    narration: "on",
    prose: "on",
  });
});

// A retired feature still stored by older sessions — `hq-dictation`, from before
// every dictated message got the HQ pass (docs/plans/hq-always.md) — is dropped
// without a warning:
void test("A retired feature still stored by older sessions — hq-dictation, from before...", async (t) => {
  t.check(resolveFeatures({ narration: "on", "hq-dictation": "on" }), {
    narration: "on",
    prose: "on",
  });
});

// ## Seeding a new session
//
// `mergeSeedFeatures` builds the initial feature map for a brand-new chat by
// layering landmark, then client pre-session choices. The more local value wins
// on conflict.
void test("mergeSeedFeatures builds the initial feature map for a brand-new chat by laye...", async (t) => {
  t.check(
    mergeSeedFeatures({
      landmark: { narration: "off", prose: "off" },
      request: { narration: "on" },
    }),
    {
    narration: "on",
    prose: "off",
  },
  );
});

// A source may be absent (no landmark, or no pre-session toggles) and
// contributes nothing; with none, the map is empty and the session falls back to
// registry defaults downstream.
void test("A source may be absent (no landmark, or no pre-session toggles) and contribut...", async (t) => {
  t.check(mergeSeedFeatures({}), {});
});

// Unknown features and invalid values from either source are dropped, so a
// hand-edited landmark or a malformed request can't seed an illegal state.
void test("Unknown features and invalid values from either source are dropped, so a hand...", async (t) => {
  t.check(
    mergeSeedFeatures({
      landmark: { bogus: "yes" },
      request: { narration: "maybe", prose: "off" },
    }),
    {
    prose: "off",
  },
  );
});

// ## Snapshot composition
//
// The server prepends the `<chat-app>` snapshot to each user message.
// Attributes are emitted in registry order.
void test("The server prepends the <chat-app> snapshot to each user message.", async (t) => {
  t.check(
    composeChatAppSnapshot({
      features: { narration: "on", prose: "off" },
    }),
    "<chat-app narration=\"on\" prose=\"off\"/>",
  );
});

// Missing keys fall back to defaults — the snapshot always carries every
// registered feature, never a partial map.
void test("Missing keys fall back to defaults — the snapshot always carries every regist...", async (t) => {
  t.check(
    composeChatAppSnapshot({
      features: {},
    }),
    "<chat-app narration=\"off\" prose=\"on\"/>",
  );
});

// The optional context attributes (computed by `session-context.ts`)
// serialize in a fixed order, and are simply omitted when absent —
// `local-time` and `channel` ride on every real send, while
// `last-activity` and `health` appear only on the first message of a
// brand-new session.
void test("The optional context attributes (computed by session-context.ts) serialize in...", async (t) => {
  t.check(
    composeChatAppSnapshot({
      features: {},
      localTime: "Wednesday 2026-05-13 10:00 (morning)",
      channel: "web-mobile",
      lastActivity: "3 days ago",
    }),
    "<chat-app narration=\"off\" prose=\"on\" local-time=\"Wednesday 2026-05-13 10:00 (morning)\" channel=\"web-mobile\" last-activity=\"3 days ago\"/>",
  );
});

// `channel` is a closed union (`shared/chat-channel.ts`), and its third member
// says something the other two don't: in the iOS app the composer, mic and
// capture are native chrome around the page rather than elements of it.
void test("channel is a closed union (shared/chat-channel.ts), and its third member says...", async (t) => {
  t.check(
    composeChatAppSnapshot({
      features: {},
      localTime: "Wednesday 2026-05-13 10:00 (morning)",
      channel: "ios-native",
    }),
    "<chat-app narration=\"off\" prose=\"on\" local-time=\"Wednesday 2026-05-13 10:00 (morning)\" channel=\"ios-native\"/>",
  );
});

// The companion-pane `open-card` attribute (box-relative path) rides on every send
// when a card is open. It's omitted when `undefined` — the caller passes
// `undefined`, never `""`, since the pipeline renders empty strings rather than
// dropping them.
void test("The companion-pane open-card attribute (box-relative path) rides on every sen...", async (t) => {
  t.check(
    composeChatAppSnapshot({
      features: {},
      openCard: "_content/notes/Trip.doc.card",
    }),
    "<chat-app narration=\"off\" prose=\"on\" open-card=\"_content/notes/Trip.doc.card\"/>",
  );
});

// Companion-pane activity rides as `<card-activity>` child elements (rendered by
// `renderActivityChildren`), turning `<chat-app>` into a paired tag. Children
// rather than attributes so a detail can be long or multi-line.
void test("Companion-pane activity rides as <card-activity> child elements (rendered by...", async (t) => {
  await t.checkText(
    composeChatAppSnapshot({
      features: {},
      openCard: "_content/notes/Trip.doc.card",
      activityChildren: '<card-activity kind="scrolled"/>\n<card-activity kind="explored">boat-water+road -> boats</card-activity>',
    }),
    `<chat-app narration="off" prose="on" open-card="_content/notes/Trip.doc.card">
<card-activity kind="scrolled"/>
<card-activity kind="explored">boat-water+road -> boats</card-activity>
</chat-app>`,
  );
});

// ## Delta parsing
//
// The agent emits `<chat-app>` tags as state mutations. The parser
// returns the deltas and the content with the tags removed.
void test("The agent emits <chat-app> tags as state mutations.", async (t) => {
  const result = parseChatAppDeltas(
    "Sure, switching to narration. <chat-app narration=\"on\"/> Done."
  );
  t.check(result, { deltas: [{ feature: "narration", value: "on" }], cleaned: "Sure, switching to narration.  Done." });
});

// The paired form (with empty body) parses the same way.
void test("The paired form (with empty body) parses the same way.", async (t) => {
  const r = parseChatAppDeltas("<chat-app prose=\"off\"></chat-app>");
  t.check(r, { deltas: [{ feature: "prose", value: "off" }], cleaned: "" });
});

// Unknown features and invalid values are dropped. The system-written
// context attributes (`time`, `local-time`, `channel`, `last-activity`,
// `calendar`, `open-card`) are always ignored on input — they're read-only; the
// agent echoing one back is not a mutation.
void test("Unknown features and invalid values are dropped.", async (t) => {
  const r = parseChatAppDeltas(
    "<chat-app narration=\"on\" bogus=\"yes\" prose=\"maybe\" time=\"now\" local-time=\"x\" channel=\"y\" last-activity=\"z\" calendar=\"w\" open-card=\"a.card\"/>"
  );
  t.check(r, { deltas: [{ feature: "narration", value: "on" }], cleaned: "" });
});

// Multiple tags in one response yield multiple deltas, in document
// order.
void test("Multiple tags in one response yield multiple deltas, in document order.", async (t) => {
  t.check(parseChatAppDeltas("<chat-app narration=\"on\"/> body <chat-app prose=\"off\"/>"), {
    deltas: [
      { feature: "narration", value: "on" },
      { feature: "prose", value: "off" },
    ],
    cleaned: " body ",
  });
});

// No tags → no deltas, content unchanged.
void test("No tags → no deltas, content unchanged.", async (t) => {
  t.check(parseChatAppDeltas("Hello world"), { deltas: [], cleaned: "Hello world" });
});
