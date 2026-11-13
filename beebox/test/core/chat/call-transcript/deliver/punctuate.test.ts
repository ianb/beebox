// Whisper times bare words but punctuates its text; the fold puts the text's
// tokens back on the timed words, skipping a token the words lack and keeping
// a word the text lacks as it was.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { withPunctuation } from "../../../../../src/core/chat/call-transcript/deliver/punctuate.js";

const w = (text: string, start: number) => ({ text, start, end: start + 0.3 });

void test("text tokens replace matching bare words, in order", (t) => {
  t.check(
    withPunctuation([w("so", 0), w("we", 0.4), w("should", 0.8), w("bring", 1.2), w("pie", 1.6)], "So, we should bring pie."),
    [w("So,", 0), w("we", 0.4), w("should", 0.8), w("bring", 1.2), w("pie.", 1.6)],
  );
  t.end();
});

void test("a token the words lack is skipped; a word the text lacks stays bare", (t) => {
  t.check(
    withPunctuation([w("okay", 0), w("um", 0.4), w("sure", 0.8)], "Okay — sure!"),
    [w("Okay", 0), w("um", 0.4), w("sure!", 0.8)],
  );
  t.end();
});
