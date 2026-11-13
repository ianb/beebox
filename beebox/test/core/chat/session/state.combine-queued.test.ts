// # Combining queued sends
//
// `combineQueuedInputs` joins text, renumbers image tokens, and takes the
// latest `openCard` (where the user is now). Activity is not on the send: it
// goes to the activity log.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { combineQueuedInputs } from "../../../../src/core/chat/session/state.js";

void test("combineQueuedInputs joins text and takes the latest openCard", async (t) => {
  const combined = combineQueuedInputs([
    { text: "first", openCard: "a.card" },
    { text: "second", openCard: "b.card" },
  ]);
  t.check(combined.text, `first

second`);
  t.check(combined.openCard, "b.card");
});

// When no queued send carries companion-pane state, the field is absent (not
// empty) so the snapshot omits it.
void test("When no queued send carries an open card, the field is absent", async (t) => {
  const plain = combineQueuedInputs([{ text: "a" }, { text: "b" }]);
  t.check(plain.openCard ?? null, null);
});
