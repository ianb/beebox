// # Chat actor receipt settlement
//
// The HTTP send outcome belongs to the emission, not to the streaming actor's
// UI lifetime. If navigation or a machine transition cancels that actor while
// the POST is in flight, its eventual success or failure must still settle the
// receipt; only the actor's later UI work is suppressed.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { settleFromTurnStart, settleRejectedTurnStart } from "../../src/machines/chatMachine/chat-receipt-settlement.js";
import { expectReceipt, pendingReceiptCount } from "../../src/input/targets/receipts.js";

// ## A cancelled actor still reports an accepted send
void test("A cancelled actor still reports an accepted send", async (t) => {
  // doctest:L16
  const accepted = expectReceipt("cancelled-success");
  const shouldContinue = settleFromTurnStart({
    messageId: "cancelled-success",
    result: { turnId: "turn-1" },
    actorCancelled: true,
  });
  const acceptedReceipt = await accepted;
  t.check({ shouldContinue, disposition: acceptedReceipt.disposition, pending: pendingReceiptCount() }, {
    shouldContinue: false,
    disposition: "sent",
    pending: 0,
  });
});

// ## A cancelled actor still reports a rejected send
void test("A cancelled actor still reports a rejected send", async (t) => {
  // doctest:L30
  const rejected = expectReceipt("cancelled-failure");
  const shouldContinue = settleRejectedTurnStart({
    messageId: "cancelled-failure",
    reason: "network failed",
    actorCancelled: true,
  });
  const rejectedReceipt = await rejected;
  t.check(
    {
      shouldContinue,
      disposition: rejectedReceipt.disposition,
      reason: rejectedReceipt.disposition === "rejected" ? rejectedReceipt.reason : null,
      pending: pendingReceiptCount(),
    },
    {
    shouldContinue: false,
    disposition: "rejected",
    reason: "network failed",
    pending: 0,
  },
  );
});

// ## Every accepted response shape keeps its disposition
void test("Every accepted response shape keeps its disposition", async (t) => {
  // doctest:L49
  const queued = expectReceipt("queued");
  const queuedContinues = settleFromTurnStart({ messageId: "queued", result: { queued: true } });
  const queuedReceipt = await queued;

  // doctest:L53
  const duplicate = expectReceipt("duplicate");
  const duplicateContinues = settleFromTurnStart({ messageId: "duplicate", result: { deduplicated: true } });
  const duplicateReceipt = await duplicate;

  // doctest:L57
  const malformed = expectReceipt("malformed");
  const malformedContinues = settleFromTurnStart({ messageId: "malformed", result: {} });
  const malformedReceipt = await malformed;

  // doctest:L61
  t.check(
    {
      queued: [queuedContinues, queuedReceipt.disposition],
      duplicate: [duplicateContinues, duplicateReceipt.disposition],
      malformed: [malformedContinues, malformedReceipt.disposition],
    },
    {
    queued: [
      true,
      "queued",
    ],
    duplicate: [
      true,
      "sent",
    ],
    malformed: [
      true,
      "rejected",
    ],
  },
  );
});

// ## Only an explicit refusal carries retry permission
void test("Only an explicit refusal carries retry permission", async (t) => {
  // doctest:L72
  const observed = expectReceipt("definitive-refusal");
  settleRejectedTurnStart({ messageId: "definitive-refusal", reason: "invalid model", definitive: true });
  t.check(await observed, {
    disposition: "rejected",
    emissionId: "definitive-refusal",
    reason: "invalid model",
    definitive: true,
  });
});
