// # User message bubble: queued and not delivered
//
// `docs/implemented-plans/chat-not-delivered.md`, Track 3. A message the agent never got
// shows a danger edge and "Not delivered" in place of the queued look; the
// person's own copy offers Resend and Discard, another user's offers neither,
// and a message whose images the box did not keep offers Discard only.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { UserMessage, type UndeliveredVerbs } from "../../../../src/components/chat/user-message/view.js";
import type { SessionEntry } from "../../../../src/api.js";

const ME = { currentUserEmail: "dana@example.com", currentUserName: "Dana" };

function entry(fields: Partial<SessionEntry>): SessionEntry {
  return { uuid: "m1", type: "user", timestamp: "2026-10-27T10:00:00Z", content: [{ type: "text", text: "<typed>Add oat milk</typed>" }], ...fields };
}

/** What a person sees on the bubble: its edge, its status line, its buttons, any alert. */
async function face(message: SessionEntry, verbs: UndeliveredVerbs) {
  const view = await mount(h(UserMessage, { entries: [message], undeliveredVerbs: verbs, ...ME }));
  const bubble = view.container.querySelector<HTMLElement>("[title]");
  const read = () => ({
    edge: [...bubble?.classList ?? []].filter((name) => name.startsWith("outline")),
    status: view.container.querySelector(".bbx-chat-user-status")?.textContent ?? null,
    buttons: [...view.container.querySelectorAll("button")].map((button) => button.textContent),
    alert: view.container.querySelector("[role=alert]")?.textContent ?? null,
  });
  return { view, read };
}

const idle: UndeliveredVerbs = { resend: async () => {}, discard: async () => {} };

void test("a queued message keeps the dashed edge and the queued line", async (t) => {
  const { view, read } = await face(entry({ pending: true, reconcileKnownUuids: [] }), idle);
  t.teardown(() => view.unmount());
  t.check(read(), { edge: ["outline-dashed", "outline-1", "outline-current"], status: "queued — waiting", buttons: [], alert: null });
});

// Undelivered outranks queued: the entry is still pending, but no longer on its way.
void test("my undelivered message offers Resend and Discard", async (t) => {
  const { view, read } = await face(entry({ pending: true, undelivered: true, reconcileKnownUuids: [] }), idle);
  t.teardown(() => view.unmount());
  t.check(read(), { edge: ["outline", "outline-2", "outline-card-danger", "outline-offset-2"], status: "Not delivered", buttons: ["Resend", "Discard"], alert: null });
});

// The box's copy of another user's send carries its own message id and sender.
void test("another user's undelivered message shows the edge and line, no buttons", async (t) => {
  const bob = entry({ uuid: "accepted-4", messageId: "m-bob", user: "Bob", userEmail: "bob@example.com", undelivered: true, reconcileKnownUuids: [] });
  const { view, read } = await face(bob, idle);
  t.teardown(() => view.unmount());
  t.check(read(), { edge: ["outline", "outline-2", "outline-card-danger", "outline-offset-2"], status: "Not delivered", buttons: [], alert: null });
});

// The box's record keeps no image bytes, so Resend could not carry them.
void test("a message that had images offers Discard only", async (t) => {
  const { view, read } = await face(entry({ uuid: "accepted-5", messageId: "m1", userEmail: "dana@example.com", undelivered: true, hadImages: true, reconcileKnownUuids: [] }), idle);
  t.teardown(() => view.unmount());
  t.check(read(), { edge: ["outline", "outline-2", "outline-card-danger", "outline-offset-2"], status: "Not delivered — images were not kept", buttons: ["Discard"], alert: null });
});

// The plan's failure mode "Discard fails": the bubble stays and says why.
void test("a failed discard keeps the bubble and shows the error", async (t) => {
  const refusing: UndeliveredVerbs = { resend: async () => {}, discard: async () => { throw new Error("This message is not marked as undelivered"); } };
  const { view, read } = await face(entry({ pending: true, undelivered: true, reconcileKnownUuids: [] }), refusing);
  t.teardown(() => view.unmount());
  const discard = [...view.container.querySelectorAll("button")].find((button) => button.textContent === "Discard");
  await view.act(() => { discard?.click(); });
  t.check(read(), { edge: ["outline", "outline-2", "outline-card-danger", "outline-offset-2"], status: "Not delivered", buttons: ["Resend", "Discard"], alert: "This message is not marked as undelivered" });
});
