// # Chat machine — paging back keeps a bounded window
//
// Each "load older" click prepends a server-bounded page, but the clicks compose:
// without a ceiling, a user paging back through a long chat rebuilds the whole
// transcript in the tab, base64 image blocks and all. `PREPEND_MESSAGES` caps the
// retained array at `MAX_RETAINED_MESSAGES`.
//
// The cap trims the *older* end of an incoming page, never the newer end — the
// newest entries are the live tail where streaming lands, and the page's newest
// entries are the ones adjacent to what the tab already holds, so the retained
// window stays contiguous.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { prependOlderMessages } from "../../src/machines/chatMachine/chat-actions.js";
import { initialChatContext } from "../../src/machines/chatMachine/chat-machine-context.js";
import { MAX_RETAINED_MESSAGES } from "../../src/machines/chat-types.js";
import type { SessionEntry } from "../../src/api-chat.js";

// Entries are identified by uuid only; nothing here reads their content.
const page = (from: number, count: number): SessionEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    uuid: `e${from + i}`,
    type: "user" as const,
    timestamp: "2026-08-25T00:00:00Z",
    content: [],
  }));
const prepend = (context: { messages: SessionEntry[] }, messages: SessionEntry[]) =>
  prependOlderMessages({
    context: { ...initialChatContext({ sessionInput: "new" }), messages: context.messages },
    event: { type: "PREPEND_MESSAGES", messages },
  });

// ## A page that fits is prepended whole
void test("A page that fits is prepended whole", async (t) => {
  const result = prepend({ messages: page(10, 3) }, page(0, 3));
  t.check(result.messages, [...page(0, 3), ...page(10, 3)]);
});

// ## A page that overflows keeps its newest entries
//
// The tab already holds all but two of its budget, so only the last two entries of
// the incoming page survive — the two immediately older than what is on screen.
void test("The tab already holds all but two of its budget, so only the last two entries...", async (t) => {
  const context = { messages: page(0, MAX_RETAINED_MESSAGES - 2) };
  const result = prepend(context, page(900, 5));
  t.check(result.messages, [...page(903, 2), ...page(0, MAX_RETAINED_MESSAGES - 2)]);
});

// ## At the ceiling, a further page is dropped
//
// The reducer returns no `messages` assignment at all, so the existing window is
// left untouched rather than rewritten. (The load-older affordance hides at the
// same threshold, so this is the backstop, not the user-visible stop.)
void test("The reducer returns no messages assignment at all, so the existing window is...", async (t) => {
  const result = prepend({ messages: page(0, MAX_RETAINED_MESSAGES) }, page(900, 5));
  t.check(result, {});
});
