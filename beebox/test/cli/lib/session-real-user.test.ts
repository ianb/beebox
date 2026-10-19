// # External assistant messages are real user input
//
// Quick chat's `<external-input>` transcript wrapper must participate in the
// same human-message paths as typed and spoken input. Otherwise retention and
// chat-history discovery can treat a person's thought as system plumbing.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import type { SessionEntry } from "../../../src/cli/lib/session-entry.js";
import { isRealUserMessage } from "../../../src/cli/lib/session-real-user.js";

function entry(text: string, type: SessionEntry["type"]): SessionEntry {
  return { uuid: "u1", type, timestamp: "2026-10-09T12:00:00Z", content: [{ type: "text", text }] };
}

// An external assistant submission is a human message.
void test("An external assistant submission is a human message.", async (t) => {
  // doctest:L18
  t.check(isRealUserMessage(entry('<external-input source="apple-app-intents">Call the office</external-input>', "user")), true);
});

// An assistant-authored mention of the wrapper does not become user input.
void test("An assistant-authored mention of the wrapper does not become user input.", async (t) => {
  // doctest:L25
  t.check(isRealUserMessage(entry("<external-input>Call the office</external-input>", "assistant")), false);
});
