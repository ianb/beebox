// # Conversation navigation intent
//
// A new card path is attention, not a recipient change. Explicit chat URLs and
// restored history entries take precedence. A cold card resolves its landmark;
// a cold bare chat retains the existing most-active bootstrap behavior.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { routeConversationRequest, createResolutionGate } from "../../../../src/components/chat/everywhere/conversation-intent.js";
import type { ConversationSelection } from "../../../../../shared/chat-composer-binding.js";

const kitchen: ConversationSelection = { kind: "ready", label: "Kitchen", target: { kind: "session", sessionId: "kitchen-chat", contextDir: "kitchen" } };
const cold: ConversationSelection = { kind: "resolving", requestId: "initial", contextDir: "" };
const base = { first: false, chatPage: false, search: {}, selection: kitchen, remembered: null, cardPath: "/house/pantry.doc.card", browseDir: null };

void test("line 15", async (t) => {
  t.check(routeConversationRequest(base), null);

  t.check(routeConversationRequest({ ...base, first: true, selection: cold })?.kind, "card");

  t.check(routeConversationRequest({ ...base, first: true, selection: cold, cardPath: null, chatPage: true })?.kind, "default");

  t.check(routeConversationRequest({ ...base, first: true, selection: cold, cardPath: null })?.contextDir, "");

  t.check(routeConversationRequest({ ...base, chatPage: true, search: { session: "garden-chat" } })?.sessionId, "garden-chat");

  const garden: ConversationSelection = { kind: "ready", label: "Garden", target: { kind: "session", sessionId: "garden-chat", contextDir: "garden" } };
  t.check(routeConversationRequest({ ...base, remembered: garden })?.sessionId, "garden-chat");

  const stored: ConversationSelection = { kind: "ready", label: "Study", target: { kind: "session", sessionId: "study-chat", contextDir: "study" } };
  t.check(routeConversationRequest({ ...base, first: true, selection: cold, remembered: null, stored }), {
    kind: "session",
    sessionId: "study-chat",
    contextDir: "study",
  });

  t.check(
    routeConversationRequest({ ...base, first: true, chatPage: true,
      search: { session: "garden-chat" }, selection: cold, stored })?.sessionId,
    "garden-chat",
  );

  t.check(
    routeConversationRequest({ ...base, first: true, selection: cold,
      remembered: garden, stored })?.sessionId,
    "garden-chat",
  );
});

// The first lookup can finish last without replacing the user's newer intent.
// A late completion after the owner unmounts is rejected by the same gate.
void test("The first lookup can finish last without replacing the user's newer intent.", async (t) => {
  const gate = createResolutionGate();
  const kitchenLookup = gate.claim();
  const gardenLookup = gate.claim();
  t.check(gate.accepts(gardenLookup), true);

  t.check(gate.accepts(kitchenLookup), false);

  gate.cancel();
  t.check(gate.accepts(gardenLookup), false);
});

// A matching history entry restores an unassigned startup. A copied explicit
// new-chat URL has no such association and remains a request for a new chat.
void test("A matching history entry restores an unassigned startup.", async (t) => {
  const start: ConversationSelection = { kind: "ready", label: "Kitchen", target: { kind: "start", clientConversationId: "pending-kitchen", contextDir: "kitchen", engine: "codex" } };
  t.check(routeConversationRequest({ ...base, first: true, chatPage: true, search: { session: "new" }, selection: start, remembered: start }), null);

  t.check(routeConversationRequest({ ...base, first: true, chatPage: true, search: { session: "new" }, selection: start, remembered: null })?.kind, "new");

  // Workspace card projection changes the URL after the first route evaluation. A
  // matching remembered startup still owns that route, so projection must not coin
  // a replacement conversation. Explicit startup changes remain new requests.

  t.check(routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new" }, selection: start, remembered: start }), null);

  t.check(routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", contextDir: "garden" }, selection: start, remembered: start })?.kind, "new");

  t.check(routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", engine: "claude" }, selection: start, remembered: start })?.kind, "new");

  t.check(routeConversationRequest({ ...base, first: false, chatPage: true, search: { session: "new", model: "different" }, selection: start, remembered: start })?.kind, "new");
});

// A restored existing target is revalidated, and Back can restore the precise
// unassigned start without coining a replacement.
void test("A restored existing target is revalidated, and Back can restore the precise u...", async (t) => {
  t.check(routeConversationRequest({ ...base, first: true })?.sessionId, "kitchen-chat");

  const pending: ConversationSelection = { kind: "ready", label: "Pending", target: { kind: "start", clientConversationId: "pending-card", contextDir: "kitchen", engine: "codex" } };
  t.check(routeConversationRequest({ ...base, remembered: pending })?.target, {
    kind: "start",
    clientConversationId: "pending-card",
    contextDir: "kitchen",
    engine: "codex",
  });
});
