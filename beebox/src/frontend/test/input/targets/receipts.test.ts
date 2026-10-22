// # Receipt correlation — acceptance-level send outcomes
//
// `expectReceipt`/`settleReceipt` bridge the gap between the emission
// dispatcher (fire-and-forget into the chat machine) and the send outcome
// (consumed inside the stream actor) — keyed by the emission id / wire
// messageId. See docs/plans/input-extraction.md chunk 3.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { expectReceipt, settleReceipt, pendingReceiptCount } from "../../../src/input/targets/receipts.js";

// ## Settle resolves the matching expectation
void test("Settle resolves the matching expectation", async (t) => {
  const p = expectReceipt("msg-1");
  settleReceipt({ disposition: "sent", emissionId: "msg-1", deduplicated: false });
  const r = await p;
  t.check(r, {
    disposition: "sent",
    emissionId: "msg-1",
    deduplicated: false,
  });

  t.check(pendingReceiptCount(), 0);
});

// ## Settling an unknown id is a no-op — outcome sites call unconditionally
//
// System sends (e.g. /compact) and pre-registry paths report outcomes too;
// nothing must throw or leak.
void test("System sends (e.g.", async (t) => {
  settleReceipt({ disposition: "queued", emissionId: "msg-never-expected" });
  t.check(pendingReceiptCount(), 0);
});

// ## Distinct sends settle independently
void test("Distinct sends settle independently", async (t) => {
  const a = expectReceipt("msg-a");
  const b = expectReceipt("msg-b");
  t.check(pendingReceiptCount(), 2);

  settleReceipt({ disposition: "queued", emissionId: "msg-b" });
  t.check(await b, {
    disposition: "queued",
    emissionId: "msg-b",
  });

  t.check(pendingReceiptCount(), 1);

  settleReceipt({ disposition: "rejected", emissionId: "msg-a", reason: "network" });
  const ra = await a;
  t.check(ra, {
    disposition: "rejected",
    emissionId: "msg-a",
    reason: "network",
  });
});

// ## Duplicate expectations share the real outcome
//
// A repeated dispatch can register the same persisted emission ID before the
// first POST settles. Both callers must receive the eventual real outcome; a
// duplicate expectation is not evidence that either send failed.
void test("A repeated dispatch can register the same persisted emission ID before the fi...", async (t) => {
  const first = expectReceipt("msg-dup");
  const second = expectReceipt("msg-dup");
  t.check(pendingReceiptCount(), 1);

  settleReceipt({ disposition: "sent", emissionId: "msg-dup", deduplicated: false });
  t.check([await first, await second], [
    {
      disposition: "sent",
      emissionId: "msg-dup",
      deduplicated: false,
    },
    {
      disposition: "sent",
      emissionId: "msg-dup",
      deduplicated: false,
    },
  ]);

  t.check(pendingReceiptCount(), 0);
});
