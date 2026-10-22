// # Reservation recovery is shared by reconnect consumers
//
// Chat and ambient history refresh can reconnect together. They must wait for the
// same exact reservation, and must not infer one from an arbitrary session ID.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { createReservationRecovery } from "../../../../src/components/chat/everywhere/reservation-recovery.js";
import { ReservationReceipts } from "../../../../src/components/chat/everywhere/reservation-receipts.js";

void test("line 11", async (t) => {
  const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
  receipts.put({ sessionId: "empty", contextDir: "papers", engine: "claude", model: "haiku" });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: unknown[] = [];
  const ensure = createReservationRecovery(receipts, async (receipt) => { calls.push(receipt); await gate; return { kind: "reserved" }; });
  const first = ensure("empty");
  const second = ensure("empty");
  await Promise.resolve();
  t.check({ shared: first === second, calls }, {
    shared: true,
    calls: [
      {
        sessionId: "empty",
        contextDir: "papers",
        engine: "claude",
        model: "haiku",
      },
    ],
  });

  release();
  const results = await Promise.all([first, second]);
  receipts.remove("empty");
  t.check({ ids: results.map((receipt) => receipt?.sessionId), retired: await ensure("empty"), unknown: await ensure("unknown"), calls: calls.length }, {
    ids: [
      "empty",
      "empty",
    ],
    retired: null,
    unknown: null,
    calls: 1,
  });
});

// Retirement before queued recovery runs prevents a late replay after send/delete.
void test("Retirement before queued recovery runs prevents a late replay after send/delete.", async (t) => {
  const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
  receipts.put({ sessionId: "empty", contextDir: "", engine: "claude" });
  let calls = 0;
  const ensure = createReservationRecovery(receipts, async () => { calls += 1; return { kind: "reserved" }; });
  const pending = ensure("empty");
  receipts.remove("empty");
  t.check({ result: await pending, calls }, {
    result: null,
    calls: 0,
  });
});

// Unsupported recovery is an error, and a failed attempt does not pin the in-flight
// slot forever.
void test("Unsupported recovery is an error, and a failed attempt does not pin the in-fl...", async (t) => {
  const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
  receipts.put({ sessionId: "empty", contextDir: "", engine: "claude" });
  let supported = false;
  const ensure = createReservationRecovery(receipts, async () => ({ kind: supported ? "reserved" : "unsupported" }));
  await t.checkThrows(async () => (await ensure("empty")), "ReservationRecoveryUnsupportedError");

  supported = true;
  t.check((await ensure("empty"))?.sessionId, "empty");
});
