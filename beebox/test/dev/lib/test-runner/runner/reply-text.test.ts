// # The text a chat turn shows, for `final_reply` audits
//
// `visibleReplyText` follows the chat's fold (`assistant-parts.ts`): text after
// the last tool call is the reply, and progress updates and earlier text fold
// unless the chat keeps them.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { type ReplyBlock, visibleReplyText } from "../../../../../src/dev/lib/test-runner/runner/reply-text.js";

const text = (t: string): ReplyBlock => ({ text: t, update: false });
const update = (t: string): ReplyBlock => ({ text: t, update: true });

// Narration and updates before a step fold; the reply after the last step stays.
void test("Narration and updates before a step fold.", async (t) => {
  t.check(visibleReplyText([text("I'll build a card type."), update("Now the schema."), text("You now have a Loans page.")], 2), "You now have a Loans page.");
});

// A reply that is only an ack shows nothing, so the chat keeps the last
// foldable line, text or update, and the audit grades it.
void test("A reply that is only an ack keeps the last foldable line.", async (t) => {
  const ack = text('<ack kind="no-response"/>');
  t.check(visibleReplyText([text("Looking."), text("I'll build a card type."), ack], 2), 'I\'ll build a card type.\n<ack kind="no-response"/>');
  t.check(visibleReplyText([text("Looking."), update("I'll build a card type."), ack], 2), 'I\'ll build a card type.\n<ack kind="no-response"/>');
  t.check(visibleReplyText([text("I'll build a card type.")], 1), "I'll build a card type.");
});

// Spoken text before a step stays whole. A folded text keeps only its callouts.
void test("Spoken text stays; a folded text keeps its callouts.", async (t) => {
  const callout = '<callout context="/loans/drill.card">Due Friday.</callout>';
  t.check(
    visibleReplyText([text("<speech>One moment.</speech>"), text(`I'll build a card type. ${callout}`), text("Plain narration."), text("Done.")], 3),
    `<speech>One moment.</speech>\n${callout}\nDone.`,
  );
});
