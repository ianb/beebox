// The intention strip shows beside a chat in a place with an intention, and
// nowhere else (docs/plans/place-intention.md, Track B). On the desktop it tops
// the cards; on the phone it shows only above the chat; it hides while the
// place page itself is visible.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { intentionStripColumn, type StripInput } from "../../../src/components/intention/IntentionStrip.js";

const writing = { path: "_content/writing/Writing.landmark.card", intention: { text: "Finish the garden post", ref: "_content/writing/Garden_Post.doc.card" } };

function input(overrides: Partial<StripInput>): StripInput {
  return { landmark: writing, dismissed: false, displayReady: true, mobile: false, split: true, transcript: "left", visiblePaths: ["_content/writing/Garden_Post.doc.card"], ...overrides };
}

void test("a chat in a place with an intention shows the strip; a chat elsewhere does not", async (t) => {
  t.check({
    inPlace: intentionStripColumn(input({})),
    // The chat has no place, or its place's landmark has no intention.
    noPlace: intentionStripColumn(input({ landmark: null })),
    noIntention: intentionStripColumn(input({ landmark: { ...writing, intention: null } })),
    dismissed: intentionStripColumn(input({ dismissed: true })),
    notReady: intentionStripColumn(input({ displayReady: false })),
  }, { inPlace: "2", noPlace: null, noIntention: null, dismissed: null, notReady: null });
});

void test("on the desktop the strip tops the cards, whichever side they are on", async (t) => {
  t.check({
    chatLeft: intentionStripColumn(input({ transcript: "left" })),
    chatRight: intentionStripColumn(input({ transcript: "right" })),
    twoCardPanes: intentionStripColumn(input({ transcript: null })),
    focus: intentionStripColumn(input({ split: false, transcript: null })),
    noCards: intentionStripColumn(input({ split: false, transcript: "full", visiblePaths: [] })),
  }, { chatLeft: "2", chatRight: "1", twoCardPanes: "1 / -1", focus: "1 / -1", noCards: "1 / -1" });
});

void test("on the phone it shows above the chat only", async (t) => {
  t.check({
    chat: intentionStripColumn(input({ mobile: true, split: false, transcript: "full", visiblePaths: [] })),
    card: intentionStripColumn(input({ mobile: true, split: false, transcript: null })),
  }, { chat: "1 / -1", card: null });
});

void test("it hides while the place page is visible, so the line shows once", async (t) => {
  t.check(intentionStripColumn(input({ visiblePaths: ["_content/writing/Garden_Post.doc.card", writing.path] })), null);
});
