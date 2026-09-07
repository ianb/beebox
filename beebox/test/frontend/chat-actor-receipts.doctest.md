# Chat actor receipt settlement

The HTTP send outcome belongs to the emission, not to the streaming actor's
UI lifetime. If navigation or a machine transition cancels that actor while
the POST is in flight, its eventual success or failure must still settle the
receipt; only the actor's later UI work is suppressed.

```ts setup
import { settleFromTurnStart, settleRejectedTurnStart } from "../../src/frontend/src/machines/chat-receipt-settlement.js";
import { expectReceipt, pendingReceiptCount } from "../../src/frontend/src/input/targets/receipts.js";
```

## A cancelled actor still reports an accepted send

```ts
const accepted = expectReceipt("cancelled-success");
const shouldContinue = settleFromTurnStart({
  messageId: "cancelled-success",
  result: { turnId: "turn-1" },
  actorCancelled: true,
});
const acceptedReceipt = await accepted;
JSON.stringify({ shouldContinue, disposition: acceptedReceipt.disposition, pending: pendingReceiptCount() })
=> {"shouldContinue":false,"disposition":"sent","pending":0}
```

## A cancelled actor still reports a rejected send

```ts
const rejected = expectReceipt("cancelled-failure");
const shouldContinue = settleRejectedTurnStart({
  messageId: "cancelled-failure",
  reason: "network failed",
  actorCancelled: true,
});
const rejectedReceipt = await rejected;
JSON.stringify({
  shouldContinue,
  disposition: rejectedReceipt.disposition,
  reason: rejectedReceipt.disposition === "rejected" ? rejectedReceipt.reason : null,
  pending: pendingReceiptCount(),
})
=> {"shouldContinue":false,"disposition":"rejected","reason":"network failed","pending":0}
```

## Every accepted response shape keeps its disposition

```ts
const queued = expectReceipt("queued");
const queuedContinues = settleFromTurnStart({ messageId: "queued", result: { queued: true } });
const queuedReceipt = await queued;

const duplicate = expectReceipt("duplicate");
const duplicateContinues = settleFromTurnStart({ messageId: "duplicate", result: { deduplicated: true } });
const duplicateReceipt = await duplicate;

const malformed = expectReceipt("malformed");
const malformedContinues = settleFromTurnStart({ messageId: "malformed", result: {} });
const malformedReceipt = await malformed;

JSON.stringify({
  queued: [queuedContinues, queuedReceipt.disposition],
  duplicate: [duplicateContinues, duplicateReceipt.disposition],
  malformed: [malformedContinues, malformedReceipt.disposition],
})
=> {"queued":[true,"queued"],"duplicate":[true,"sent"],"malformed":[true,"rejected"]}
```

## Only an explicit refusal carries retry permission

```ts
const observed = expectReceipt("definitive-refusal");
settleRejectedTurnStart({ messageId: "definitive-refusal", reason: "invalid model", definitive: true });
JSON.stringify(await observed)
=> {"disposition":"rejected","emissionId":"definitive-refusal","reason":"invalid model","definitive":true}
```
