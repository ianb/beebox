// # Undelivered and discarded chat messages on the acceptance record
//
// `docs/plans/chat-not-delivered.md`, Track 1. A message the box accepted and
// then dropped carries a `chat-user-message-undelivered` marker. The acceptance
// reader returns it marked, past the 10-minute window that retires an ordinary
// accepted message, until the person discards it. A discard is refused unless
// the marker exists, so it cannot hide a message the agent received.

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { createEventBus, type EventBus } from "../../../../src/core/event-bus/core.js";
import { readAcceptedMessages } from "../../../../src/core/chat/session/accepted-messages.js";
import { discardUndelivered } from "../../../../src/core/chat/session/undelivered.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";

const ACCEPTED_AT = "2026-10-27T09:00:00.000Z";
// Past `ACCEPTED_WINDOW_MS` (10 minutes) after ACCEPTED_AT.
const LATER = new Date("2026-10-27T10:00:00.000Z");

async function busWithTwoSends(t: Test): Promise<EventBus> {
  const box = await makeTmpBox({ git: "none" });
  t.teardown(() => box.cleanup());
  const bus = createEventBus(box.root);
  t.teardown(() => { bus.close(); });
  for (const [messageId, message] of [["m-oat", "add oat milk"], ["m-eggs", "and eggs"]] as const) {
    bus.emit("chat-user-message", { sessionId: "s1", message, user: null, timestamp: ACCEPTED_AT, messageId });
  }
  return bus;
}

const read = (bus: EventBus) => readAcceptedMessages(bus, { sessionId: "s1", now: LATER, viewerEmail: null, history: [] });

// ## An undelivered message outlives the acceptance window; a delivered one does not
void test("an undelivered message is returned past the acceptance window", async (t) => {
  const bus = await busWithTwoSends(t);
  bus.emit("chat-user-message-undelivered", { sessionId: "s1", messageId: "m-oat", timestamp: ACCEPTED_AT });
  t.check(read(bus), [{
    uuid: "accepted-1",
    type: "user",
    timestamp: ACCEPTED_AT,
    content: [{ type: "text", text: "add oat milk" }],
    messageId: "m-oat",
    undelivered: true,
    reconcileKnownUuids: [],
  }]);
});

// ## Discard hides the message; a second discard records nothing more
void test("a discarded message is no longer returned", async (t) => {
  const bus = await busWithTwoSends(t);
  bus.emit("chat-user-message-undelivered", { sessionId: "s1", messageId: "m-oat", timestamp: ACCEPTED_AT });
  const outcomes = [
    discardUndelivered(bus, { sessionId: "s1", messageId: "m-oat", now: LATER }),
    discardUndelivered(bus, { sessionId: "s1", messageId: "m-oat", now: LATER }),
  ];
  t.check({
    outcomes,
    discards: bus.readRecent({ event: "chat-user-message-discarded", limit: 10 }).map((e) => e.data),
    accepted: read(bus),
  }, {
    outcomes: ["discarded", "discarded"],
    discards: [{ sessionId: "s1", messageId: "m-oat", timestamp: LATER.toISOString() }],
    accepted: [],
  });
});

// ## A discard with no undelivered marker is refused (fail closed)
//
// "m-eggs" was accepted and never marked: the agent may have it. A marker for
// "m-oat" in another session does not cover this one either.
void test("a discard without a matching undelivered marker records nothing", async (t) => {
  const bus = await busWithTwoSends(t);
  bus.emit("chat-user-message-undelivered", { sessionId: "s2", messageId: "m-oat", timestamp: ACCEPTED_AT });
  t.check({
    unmarked: discardUndelivered(bus, { sessionId: "s1", messageId: "m-eggs", now: LATER }),
    otherSession: discardUndelivered(bus, { sessionId: "s1", messageId: "m-oat", now: LATER }),
    discards: bus.readRecent({ event: "chat-user-message-discarded", limit: 10 }),
  }, { unmarked: "not-found", otherSession: "not-found", discards: [] });
});

// ## A send accepted before the chat had an id is found under the id it got
//
// The acceptance row records the session the send targeted, which for a chat
// with no id yet is null; the drop marker records the id assigned since. The
// reload asks with that id, and the id-less row's sender check still applies.
void test("an undelivered message accepted with no session matches its marker's session", async (t) => {
  const box = await makeTmpBox({ git: "none" });
  t.teardown(() => box.cleanup());
  const bus = createEventBus(box.root);
  t.teardown(() => { bus.close(); });
  const rosa = { email: "rosa@example.com", name: "Rosa Okafor" };
  bus.emit("chat-user-message", { sessionId: null, message: "<typed user=\"Rosa Okafor\" user-email=\"rosa@example.com\">add oat milk</typed>", user: rosa, timestamp: ACCEPTED_AT, messageId: "m-oat" });
  bus.emit("chat-user-message-undelivered", { sessionId: "s1", messageId: "m-oat", timestamp: ACCEPTED_AT });
  const readAs = (viewerEmail: string) => readAcceptedMessages(bus, { sessionId: "s1", now: LATER, viewerEmail, history: [] }).map((m) => m.messageId);
  t.check({ rosa: readAs("rosa@example.com"), tomas: readAs("tomas@example.com") }, { rosa: ["m-oat"], tomas: [] });
});

// ## A slash command names its sender through the row
//
// The sender does not attribute a slash command's text (`user-message-sender.ts`:
// any prefix would stop the CLI parsing it), so the text names nobody. The
// row's `user` does, and without it another person's dropped command would
// show as the viewer's own.
void test("an accepted message with no identity in its text takes the row's sender", async (t) => {
  const box = await makeTmpBox({ git: "none" });
  t.teardown(() => box.cleanup());
  const bus = createEventBus(box.root);
  t.teardown(() => { bus.close(); });
  bus.emit("chat-user-message", { sessionId: "s1", message: "/compact", user: { email: "tomas@example.com", name: "Tomas Marlowe" }, timestamp: ACCEPTED_AT, messageId: "m-compact" });
  bus.emit("chat-user-message-undelivered", { sessionId: "s1", messageId: "m-compact", timestamp: ACCEPTED_AT });
  t.check(readAcceptedMessages(bus, { sessionId: "s1", now: LATER, viewerEmail: "rosa@example.com", history: [] }), [{
    uuid: "accepted-1",
    type: "user",
    timestamp: ACCEPTED_AT,
    content: [{ type: "text", text: "/compact" }],
    user: "Tomas Marlowe",
    userEmail: "tomas@example.com",
    messageId: "m-compact",
    undelivered: true,
    reconcileKnownUuids: [],
  }]);
});
