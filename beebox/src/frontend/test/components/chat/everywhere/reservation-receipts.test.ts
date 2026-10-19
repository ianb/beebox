// # Reservation receipt storage recovery
//
// Session storage can retain truncated or incompatible metadata after a browser
// crash or an older build. That metadata is local cache state, so a malformed
// value starts empty and the next legitimate reservation can write a clean map.
// Actual storage access failures still escape the constructor — only metadata
// decoding is recoverable.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { ReservationReceipts } from "../../../../src/components/chat/everywhere/reservation-receipts.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const receipt = { sessionId: "session-1", contextDir: "_content/movies", engine: "claude" as const, model: "sonnet" };

// ## Malformed JSON is discarded and replaced by the next legitimate receipt
void test("Malformed JSON is discarded and replaced by the next legitimate receipt", async (t) => {
  // doctest:L24
  const storage = new MemoryStorage();
  storage.values.set("bbx-conversation-reservations/test1", "{not-json");
  const receipts = new ReservationReceipts(storage, "test1");
  receipts.put(receipt);
  const restored = new ReservationReceipts(storage, "test1");
  t.check(restored.get("session-1"), {
    sessionId: "session-1",
    contextDir: "_content/movies",
    engine: "claude",
    model: "sonnet",
  });
});

// ## Invalid receipt shape is discarded the same way
void test("Invalid receipt shape is discarded the same way", async (t) => {
  // doctest:L36
  const storage = new MemoryStorage();
  storage.values.set("bbx-conversation-reservations/test1", JSON.stringify([["session-1", { sessionId: "other-session", contextDir: "_content/movies", engine: "claude" }]]));
  const receipts = new ReservationReceipts(storage, "test1");
  receipts.put(receipt);
  const restored = new ReservationReceipts(storage, "test1");
  t.check(restored.get("session-1"), {
    sessionId: "session-1",
    contextDir: "_content/movies",
    engine: "claude",
    model: "sonnet",
  });
});

// ## Storage access failures remain visible
void test("Storage access failures remain visible", async (t) => {
  // doctest:L48
  const inaccessible = { getItem: () => { throw new Error("storage unavailable"); }, setItem: () => {} };
  await t.checkThrows(async () => (new ReservationReceipts(inaccessible, "test1")), "Error: storage unavailable");
});
