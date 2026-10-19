// # The start target carries engine AND model
//
// A cross-engine pick in the model panel is one gesture: `onChooseStart({ engine,
// model })`. Both halves have to survive into the conversation target, or the new
// chat starts on the chosen engine's *default* model and the boxholder has to
// pick again — the two-step switch of
// `issues/bugs/2026-08-30-engine-switch-forces-default-model-first.md`.
//
// There are two places that build a start target. The other one
// (`everywhere/resolve-conversation.ts`) already carried the model, which is how
// this one kept dropping it unnoticed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { conversationTargetFor } from "../../../../src/components/chat/conversation/use-conversation-machine.js";

// ## A cross-engine pick keeps its model
void test("A cross-engine pick keeps its model", async (t) => {
  // doctest:L20
  t.check(
    conversationTargetFor(
      { sessionInput: "new", contextDir: "", startEngine: "claude", startModel: "pinned-model" },
      "fresh-id",
    ),
    {
    kind: "start",
    clientConversationId: "fresh-id",
    contextDir: "",
    engine: "claude",
    model: "pinned-model",
  },
  );
});

// ## Choosing only an engine leaves the model unset
//
// Absent means "follow the engine's default", which is not the same as pinning
// that default — so no `model` key is emitted at all.
void test("Absent means \"follow the engine's default\", which is not the same as pinning...", async (t) => {
  // doctest:L33
  t.check(
    conversationTargetFor(
      { sessionInput: "new", contextDir: "", startEngine: "codex" },
      "fresh-id",
    ),
    {
    kind: "start",
    clientConversationId: "fresh-id",
    contextDir: "",
    engine: "codex",
  },
  );
});

// ## An unknown engine falls back to claude, and a resumed session ignores both
void test("An unknown engine falls back to claude, and a resumed session ignores both", async (t) => {
  // doctest:L43
  const fallback = conversationTargetFor({ sessionInput: "new", contextDir: "" }, "fresh-id");
  t.check(fallback.kind === "start" ? fallback.engine : fallback.kind, "claude");

  // doctest:L47
  t.check(
    conversationTargetFor(
      { sessionInput: "abc123", contextDir: "notes", startEngine: "codex", startModel: "pinned-model" },
      "fresh-id",
    ),
    {
    kind: "session",
    sessionId: "abc123",
    contextDir: "notes",
  },
  );
});
