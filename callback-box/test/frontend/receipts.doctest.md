# Receipt correlation — acceptance-level send outcomes

`expectReceipt`/`settleReceipt` bridge the gap between the emission
dispatcher (fire-and-forget into the chat machine) and the send outcome
(consumed inside the stream actor) — keyed by the emission id / wire
messageId. See docs/plans/input-extraction.md chunk 3.

```ts setup
import { expectReceipt, settleReceipt, pendingReceiptCount } from "../../src/frontend/src/input/targets/receipts.js";
```

## Settle resolves the matching expectation, once

```ts
const p = expectReceipt("msg-1");
settleReceipt({ disposition: "sent", emissionId: "msg-1", deduplicated: false });
const r = await p;
r.disposition
=> sent

pendingReceiptCount()
=> 0

// A second settle for the same id is a silent no-op (nothing expects it).
settleReceipt({ disposition: "rejected", emissionId: "msg-1", reason: "late" });
pendingReceiptCount()
=> 0
```

## Settling an unknown id is a no-op — outcome sites call unconditionally

System sends (e.g. /compact) and pre-registry paths report outcomes too;
nothing must throw or leak.

```ts
settleReceipt({ disposition: "queued", emissionId: "msg-never-expected" });
pendingReceiptCount()
=> 0
```

## Distinct sends settle independently

```ts
const a = expectReceipt("msg-a");
const b = expectReceipt("msg-b");
pendingReceiptCount()
=> 2

settleReceipt({ disposition: "queued", emissionId: "msg-b" });
(await b).disposition
=> queued

pendingReceiptCount()
=> 1

settleReceipt({ disposition: "rejected", emissionId: "msg-a", reason: "network" });
const ra = await a;
ra.disposition === "rejected" && ra.reason === "network"
=> true
```
