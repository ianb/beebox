// # The text a chat turn shows, for `final_reply` audits
//
// `visibleReplyText` follows the chat's fold (`assistant-parts.ts`): text after
// the last tool call is the reply, and earlier text folds unless the chat
// keeps it.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { visibleReplyText } from "../../../../../src/dev/lib/test-runner/runner/reply-text.js";

// Narration before a step folds; the reply after the last step stays.
void test("Narration before a step folds.", async (t) => {
  t.check(visibleReplyText(["I'll build a card type.", "You now have a Loans page."], 1), "You now have a Loans page.");
});

// A reply that is only an ack shows nothing, so the chat keeps the last earlier
// line, and the audit grades it.
void test("A reply that is only an ack keeps the last earlier line.", async (t) => {
  t.check(visibleReplyText(["Looking.", "I'll build a card type.", '<ack kind="no-response"/>'], 2), 'I\'ll build a card type.\n<ack kind="no-response"/>');
  t.check(visibleReplyText(["I'll build a card type."], 1), "I'll build a card type.");
});

// Spoken text and callouts before a step stay visible in the chat.
void test("Spoken text and callouts before a step stay.", async (t) => {
  const callout = '<callout context="/loans/drill.card">Due Friday.</callout>';
  t.check(visibleReplyText(["<speech>One moment.</speech>", `Checking. ${callout}`, "Plain narration.", "Done."], 3), `<speech>One moment.</speech>\nChecking. ${callout}\nDone.`);
});
