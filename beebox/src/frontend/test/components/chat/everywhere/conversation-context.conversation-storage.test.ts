// # Conversation storage belongs to a box instance
//
// Two router worktrees can expose `test1` on the same origin. Visiting one after
// the other must not restore a foreign conversation or its ambient observers.
// Production keeps its existing keys. Unattributable old development records are
// left untouched, rather than guessed into either clone.

import { test } from "tap";
import "agent-doctest/tap";
import { storageScopeFor } from "../../../../src/lib/storage-scope.js";
import { readConversation, saveConversation } from "../../../../src/components/chat/everywhere/conversation-context/conversation-state.js";
import { readTrackedSessions, writeTrackedSessions } from "../../../../src/components/chat/ambient/tracked-sessions.js";
import { readActiveSessions, writeActiveSessions } from "../../../../src/components/chat/ambient/AmbientReplies/active-sessions.js";

// Only a ready selection is ever stored or restored, so only it has a label.
function labelOf(selection: ReturnType<typeof readConversation>): string | undefined {
  return selection?.kind === "ready" ? selection.label : undefined;
}

void test("line 20", async (t) => {
  t.teardown(async () => {
    try {
      if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L21
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const first = storageScopeFor("/chat-everywhere/test1/api");
  const second = storageScopeFor("/paper-cards/test1/api");
  const production = storageScopeFor("/test1/api");
  saveConversation(production, { kind: "ready", label: "Old selection", target: { kind: "session", sessionId: "old-chat", contextDir: "" } });
  saveConversation(first, { kind: "ready", label: "First clone", target: { kind: "session", sessionId: "first-chat", contextDir: "" } });
  writeTrackedSessions(first, [{ sessionId: "first-chat", label: "First clone" }]);
  writeActiveSessions(first, ["first-chat"]);
  t.check(readConversation(second), null);

  // doctest:L37
  t.check(readTrackedSessions(second), []);

  // doctest:L40
  t.check(readActiveSessions(second), []);

  // doctest:L43
  t.check(labelOf(readConversation(first)), "First clone");

  // doctest:L46
  t.check(readTrackedSessions(first).map((session) => session.sessionId), [
    "first-chat",
  ]);

  // doctest:L49
  t.check(readActiveSessions(first), [
    "first-chat",
  ]);

  // doctest:L52
  t.check(labelOf(readConversation(production)), "Old selection");

  // doctest:L55
  await t.checkText(values.has("bbx-conversation:test1"), "true");
});
