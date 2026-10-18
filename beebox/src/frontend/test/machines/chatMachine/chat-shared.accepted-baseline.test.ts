// # An acceptance is reconciled by its own echo, not blacklisted by it
//
// `chat.bootstrap` answers a page load with two records: the `history` (what is
// durable) and `pending` (what the box has *accepted* but the transcript may not
// show yet — `accepted-messages.ts`). The client merges them with
// `reconcilePending`, retiring a pending copy once a transcript entry repeating
// its words arrives.
//
// Each pending message carries a **baseline** of entry uuids that cannot serve as
// that echo. Without one, an old turn that happens to repeat the same words
// answers a new message, which then vanishes on reload.
//
// The baseline has to be dated per message. When it was "every uuid in the
// history being returned", it also blacklisted each message's OWN echo whenever
// the transcript had already caught up by the time bootstrap ran — which is
// exactly what a reload does. The pending copy could then never be retired, and
// `reconcilePending` appends what is left after the server messages, so a reload
// pinned duplicates of the last few messages to the bottom of the chat until they
// aged out of the ten-minute acceptance window.

import { test } from "tap";
import "agent-doctest/tap";
import { readAcceptedMessages } from "../../../../core/chat/session/accepted-messages.js";
import { reconcilePending } from "../../../src/machines/chatMachine/chat-shared.js";
import { createEventBus } from "../../../../core/event-bus/core.js";
import { makeTmpBox } from "../../../../../test/helpers/test-helpers.js";
import type { SessionContentBlock } from "../../../src/api-chat.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-26T13:00:00.000Z");

/** One transcript entry, as both records name it: a uuid and a moment. */
function entry({ uuid, timestamp, text }: { uuid: string; timestamp: string; text: string }) {
  return { uuid, type: "user" as const, timestamp, content: [{ type: "text" as const, text }] };
}

function accept(bus: ReturnType<typeof createEventBus>, { at, message }: { at: string; message: string }) {
  bus.emit("chat-user-message", { sessionId: SESSION, timestamp: at, message, user: null });
}

function textOf(e: { content: SessionContentBlock[] } | undefined) {
  return (e?.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ## The reload that produced duplicates
//
// A conversation that already contains the word "yes", then a message accepted at
// 12:54 whose echo the agent wrote eight seconds later. By the time the page
// reloads, both are in the history.
void test("A conversation that already contains the word \"yes\", then a message accepted...", async (t) => {
  // doctest:L52
  const box = await makeTmpBox();
  const bus = createEventBus(box.root);
  accept(bus, { at: "2026-08-26T12:54:34.000Z", message: "yes" });

  // doctest:L56
  const history = [
    entry({ uuid: "item-100", timestamp: "2026-08-26T11:00:00.000Z", text: "yes" }),
    entry({ uuid: "item-255", timestamp: "2026-08-26T12:54:42.000Z", text: "yes" }),
  ];
  const [pending] = readAcceptedMessages(bus, {
    sessionId: SESSION,
    now: NOW,
    viewerEmail: null,
    history: history.map((e) => ({ uuid: e.uuid, timestamp: e.timestamp })),
  });

  // doctest:L67
  await t.checkText(
    // The old entry cannot answer for this message; the echo can.
    JSON.stringify(pending?.reconcileKnownUuids),
    "[\"item-100\"]",
  );

  // So the client retires it, and the conversation is the two entries it actually
  // contains — not three with the last one repeated.

  // doctest:L76
  const merged = reconcilePending({ serverMessages: history, pendingMessages: pending ? [pending] : [] });
  t.check({ messages: merged.messages.map((e) => e.uuid), stillPending: merged.pendingMessages.length }, {
    messages: [
      "item-100",
      "item-255",
    ],
    stillPending: 0,
  });

  // ## What the baseline is still for
  //
  // Nothing above weakens the protection it was added for. Take the same
  // conversation with the echo not yet written: the only "yes" on record is the old
  // one, and it must not answer for the new message.

  // doctest:L88
  const [stillWaiting] = readAcceptedMessages(bus, {
    sessionId: SESSION,
    now: NOW,
    viewerEmail: null,
    history: [{ uuid: "item-100", timestamp: "2026-08-26T11:00:00.000Z" }],
  });
  const notYet = reconcilePending({
    serverMessages: history.slice(0, 1),
    pendingMessages: stillWaiting ? [stillWaiting] : [],
  });

  // doctest:L99
  t.check({ messages: notYet.messages.map(textOf), stillPending: notYet.pendingMessages.length }, {
    messages: [
      "yes",
      "yes",
    ],
    stillPending: 1,
  });

  // An entry with no usable timestamp counts as older, so it never stands in as the
  // echo. The echo is written after the acceptance — the agent receives the message,
  // then records it — so an undatable entry is old history far more often than it is
  // the thing being waited for, and letting it reconcile would retire a message it
  // has nothing to do with.

  // doctest:L110
  const [undated] = readAcceptedMessages(bus, {
    sessionId: SESSION,
    now: NOW,
    viewerEmail: null,
    history: [{ uuid: "item-100", timestamp: "" }],
  });

  // doctest:L117
  t.check(undated?.reconcileKnownUuids, [
    "item-100",
  ]);
});

// ## The bus copy strips `[image#N]` from the body only
//
// The bus carries the message text without its image bytes, so the body's
// `[image#N]` anchors are stripped to match the transcript, where they became
// image blocks. The same token inside the trailing `<attachments>` block is the
// line naming the image's original file; the transcript keeps that as text
// (`shared/chat-content-blocks.ts`), so the bus copy must keep it too, or the
// two texts stop comparing equal and the message renders twice.
void test("The bus carries the message text without its image bytes, so the body's [imag...", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L131
  const box = await makeTmpBox();
  const bus = createEventBus(box.root);
  accept(bus, {
    at: "2026-08-26T12:54:34.000Z",
    message: "<typed>look [image#1]</typed>\n<attachments>\n[image#1]: _tmp/shot.png\n</attachments>",
  });
  const [accepted] = readAcceptedMessages(bus, { sessionId: SESSION, now: NOW, viewerEmail: null, history: [] });
  await t.checkText(textOf(accepted), `<typed>look </typed>
<attachments>
[image#1]: _tmp/shot.png
</attachments>`);
});
