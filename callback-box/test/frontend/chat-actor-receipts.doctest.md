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
