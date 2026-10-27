// # mergeAcceptedIntoPending pairs copies of one send by message id
//
// The box's record of accepted messages (`chat.bootstrap`'s `pending`) carries
// each send's message id, and an optimistic copy's uuid is that id. Pairing by
// text instead matches two identical sends crosswise; when only one of them was
// dropped, the wrong bubble says "Not delivered"
// (`docs/plans/chat-not-delivered.md`, plan review).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mergeAcceptedIntoPending } from "../../../src/machines/chatMachine/chat-shared.js";
import type { PendingSessionEntry } from "../../../src/api.js";

function optimistic(messageId: string, text: string): PendingSessionEntry {
  return { uuid: messageId, type: "user", timestamp: "2026-10-27T10:00:00Z", content: [{ type: "text", text }], pending: true, reconcileKnownUuids: [] };
}

function accepted({ row, messageId, ...extra }: { row: number; messageId: string; undelivered?: true }): PendingSessionEntry {
  return { uuid: `accepted-${String(row)}`, type: "user", timestamp: "2026-10-27T10:00:00Z", content: [{ type: "text", text: "<typed>yes</typed>" }], messageId, ...extra, reconcileKnownUuids: [] };
}

// Two "yes" sends; the box dropped the second. The first accepted row would
// have taken the first optimistic copy by text.
void test("two identical sends keep their own outcomes", async (t) => {
  const pendingMessages = [optimistic("m-first", "<typed>yes</typed>"), optimistic("m-second", "<typed>yes</typed>")];
  const merged = mergeAcceptedIntoPending({
    pendingMessages,
    accepted: [accepted({ row: 2, messageId: "m-second", undelivered: true }), accepted({ row: 1, messageId: "m-first" })],
  });
  t.check(merged.map((entry) => ({ uuid: entry.uuid, undelivered: entry.undelivered })), [
    { uuid: "m-first", undelivered: undefined },
    { uuid: "m-second", undelivered: true },
  ]);
});

// A message sent from another tab has no copy here, so the accepted row is
// added, keeping its id for the next marker to match.
void test("an accepted send with no copy here is added", async (t) => {
  const merged = mergeAcceptedIntoPending({ pendingMessages: [], accepted: [accepted({ row: 3, messageId: "m-other-tab", undelivered: true })] });
  t.check(merged.map((entry) => ({ uuid: entry.uuid, messageId: entry.messageId, undelivered: entry.undelivered })), [
    { uuid: "accepted-3", messageId: "m-other-tab", undelivered: true },
  ]);
});
