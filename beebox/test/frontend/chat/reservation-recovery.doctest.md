# Reservation recovery is shared by reconnect consumers

Chat and ambient history refresh can reconnect together. They must wait for the
same exact reservation, and must not infer one from an arbitrary session ID.

```ts setup
import { createReservationRecovery } from "../../../src/frontend/src/components/chat/everywhere/reservation-recovery.js";
import { ReservationReceipts } from "../../../src/frontend/src/components/chat/everywhere/reservation-receipts.js";
```

```ts
const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
receipts.put({ sessionId: "empty", contextDir: "papers", engine: "claude", model: "haiku" });
let release!: () => void;
const gate = new Promise<void>((resolve) => { release = resolve; });
const calls: unknown[] = [];
const ensure = createReservationRecovery(receipts, async (receipt) => { calls.push(receipt); await gate; return { kind: "reserved" }; });
const first = ensure("empty");
const second = ensure("empty");
await Promise.resolve();
JSON.stringify({ shared: first === second, calls })
=> {"shared":true,"calls":[{"sessionId":"empty","contextDir":"papers","engine":"claude","model":"haiku"}]}

release();
const results = await Promise.all([first, second]);
receipts.remove("empty");
JSON.stringify({ ids: results.map((receipt) => receipt?.sessionId), retired: await ensure("empty"), unknown: await ensure("unknown"), calls: calls.length })
=> {"ids":["empty","empty"],"retired":null,"unknown":null,"calls":1}
```

Retirement before queued recovery runs prevents a late replay after send/delete.

```ts
const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
receipts.put({ sessionId: "empty", contextDir: "", engine: "claude" });
let calls = 0;
const ensure = createReservationRecovery(receipts, async () => { calls += 1; return { kind: "reserved" }; });
const pending = ensure("empty");
receipts.remove("empty");
JSON.stringify({ result: await pending, calls })
=> {"result":null,"calls":0}
```

Unsupported recovery is an error, and a failed attempt does not pin the in-flight
slot forever.

```ts
const receipts = new ReservationReceipts({ getItem: () => null, setItem: () => {} }, "test/scope");
receipts.put({ sessionId: "empty", contextDir: "", engine: "claude" });
let supported = false;
const ensure = createReservationRecovery(receipts, async () => ({ kind: supported ? "reserved" : "unsupported" }));
await ensure("empty")
=> throws ReservationRecoveryUnsupportedError

supported = true;
(await ensure("empty"))?.sessionId
=> empty
```
