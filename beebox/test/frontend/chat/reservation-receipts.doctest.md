# Reservation receipt storage recovery

Session storage can retain truncated or incompatible metadata after a browser
crash or an older build. That metadata is local cache state, so a malformed
value starts empty and the next legitimate reservation can write a clean map.
Actual storage access failures still escape the constructor — only metadata
decoding is recoverable.

```ts setup
import { ReservationReceipts } from "../../../src/frontend/src/components/chat/everywhere/reservation-receipts.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const receipt = { sessionId: "session-1", contextDir: "_content/movies", engine: "claude" as const, model: "sonnet" };
```

## Malformed JSON is discarded and replaced by the next legitimate receipt

```ts
const storage = new MemoryStorage();
storage.values.set("bbx-conversation-reservations/test1", "{not-json");
const receipts = new ReservationReceipts(storage, "test1");
receipts.put(receipt);
const restored = new ReservationReceipts(storage, "test1");
JSON.stringify(restored.get("session-1"))
=> {"sessionId":"session-1","contextDir":"_content/movies","engine":"claude","model":"sonnet"}
```

## Invalid receipt shape is discarded the same way

```ts
const storage = new MemoryStorage();
storage.values.set("bbx-conversation-reservations/test1", JSON.stringify([["session-1", { sessionId: "other-session", contextDir: "_content/movies", engine: "claude" }]]));
const receipts = new ReservationReceipts(storage, "test1");
receipts.put(receipt);
const restored = new ReservationReceipts(storage, "test1");
JSON.stringify(restored.get("session-1"))
=> {"sessionId":"session-1","contextDir":"_content/movies","engine":"claude","model":"sonnet"}
```

## Storage access failures remain visible

```ts
const inaccessible = { getItem: () => { throw new Error("storage unavailable"); }, setItem: () => {} };
new ReservationReceipts(inaccessible, "test1")
=> throws Error: storage unavailable
```
