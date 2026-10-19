// # The caret stays out of text the user did not type
//
// The composer textareas are controlled: their `value` comes from the emission
// store. A write the person did not make — a restored draft, a clear after send,
// token normalization — replaces `value` while the browser keeps the text
// selection at its old character offset, so the next keystroke lands *inside* the
// new text. That is how a send once went out with a stale draft wrapped around the
// real message, spliced at a mid-word offset with no caret-aware code on the path
// (`issues/bugs/2026-08-22-composer-draft-splices-into-another-message.md`).
//
// `caretAfterTextChange` is the decision, separated from the DOM so it is testable:
// where the caret belongs, or `null` for "leave it alone".

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { caretAfterTextChange } from "../../../src/components/chat/composer-caret.js";

// A keystroke's own change is left alone. The person typing is the only one who
// knows where they want the caret, and moving it would fight them.
void test("A keystroke's own change is left alone.", async (t) => {
  t.check(
    [
      caretAfterTextChange({ text: "draft surv", lastTyped: "draft surv" }),
      caretAfterTextChange({ text: "", lastTyped: "" }),
    ],
    [
    null,
    null,
  ],
  );
});

// Anything else reached the store another way, and goes to the end of the text —
// where someone who keeps typing expects to be. This is the splice case: the
// person had typed `draft survives?` with the caret inside `surv|ives?`, then a
// restore replaced the whole value.
void test("Anything else reached the store another way, and goes to the end of the text...", async (t) => {
  t.check(caretAfterTextChange({ text: "In 2 minutes, remind me to stretch.", lastTyped: "draft survives?" }), 35);
});

// A clear after send is the same shape, and lands the caret at 0 rather than
// leaving it at the offset the sent text had:
void test("A clear after send is the same shape, and lands the caret at 0 rather than le...", async (t) => {
  t.check(caretAfterTextChange({ text: "", lastTyped: "draft survives?" }), 0);
});

// Nothing typed yet — a fresh mount, a restore into an untouched composer — is
// also not the user's keystroke, so the caret follows the text it was handed:
void test("Nothing typed yet — a fresh mount, a restore into an untouched composer — is...", async (t) => {
  t.check(caretAfterTextChange({ text: "restored draft", lastTyped: null }), 14);
});
