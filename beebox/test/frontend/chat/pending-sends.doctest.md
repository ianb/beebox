# Pending web sends retain completed content and original destination

Storage is transactional with respect to the live snapshot. A quota error
prevents staging, so the caller can preserve its draft. Reopening a tab never
resends a saved message automatically.

```ts setup
import { createPendingSendsStore, quarantineUnreadablePendingSends, pendingSendRecoveryCopies } from "../../../src/frontend/src/components/chat/conversation/pending-sends.js";
import type { Emission } from "../../../src/frontend/src/input/emission.js";
import type { SendBinding } from "../../../src/shared/chat-composer-binding.js";
```

```ts
const data = new Map<string, string>();
let blocked = false;
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { if (blocked) throw new Error("quota"); data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
};
const emission: Emission = { id: "voice-1", origin: "voice", text: "Check [image#1]", diarized: true,
  images: [{ id: 1, mimeType: "image/png", dataBase64: "a".repeat(600_000) }],
  files: [{ id: 2, path: "_tmp/report.pdf", originalName: "report.pdf", mimetype: "application/pdf", size: 512 }],
  selections: [{ id: 3, ref: "/_content/house/Report.doc.card", text: "Quoted evidence", position: "p2", anchor: "check", spokenWords: 1 }],
  words: [{ word: "Check", confidence: 0.9 }], spokenStart: 0,
};
const binding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "kitchen", contextDir: "_content/kitchen" }, attention: { surface: "card", focusedRef: "_content/house/Report.doc.card", transcript: "hidden" } };
const store = createPendingSendsStore(storage, "test");
let notices = 0;
const unsubscribe = store.subscribe(() => { notices++; });
blocked = true;
store.stage(emission, binding)
=> throws Error: quota

store.getSnapshot().length
=> 0

notices
=> 0

blocked = false;
store.stage(emission, binding);
const recovered = createPendingSendsStore(storage, "test");
recovered.getSnapshot()[0]?.status
=> recovered

recovered.getSnapshot()[0]?.emission.images[0]?.dataBase64.length
=> 600000

JSON.stringify(recovered.getSnapshot()[0]?.emission.words)
=> [{"word":"Check","confidence":0.9}]

JSON.stringify(recovered.getSnapshot()[0]?.emission.selections)
=> [{"id":3,"ref":"/_content/house/Report.doc.card","text":"Quoted evidence","position":"p2","anchor":"check","spokenWords":1}]

recovered.getSnapshot()[0]?.binding.target.kind === "session" && recovered.getSnapshot()[0]?.binding.target.sessionId
=> kitchen

createPendingSendsStore(storage, "other").getSnapshot().length
=> 0
```

Same-ID retries must preserve content and binding. Late receipts remove only the
original saved message, leaving a later draft or another saved send untouched.

```ts continue
store.rejected(emission.id, "Offline");
store.getSnapshot()[0]?.reason
=> Offline

store.stage(emission, { ...binding, target: { kind: "session", sessionId: "garden", contextDir: "_content/garden" } })
=> throws PendingSendChangedError: A saved message cannot change its destination or content

store.stage(emission, binding);
store.getSnapshot()[0]?.status
=> pending

store.stage({ ...emission, id: "hq-2", hqText: true, hqService: "openai", words: undefined }, binding);
store.accepted("voice-1");
store.getSnapshot().length
=> 1

const hq = createPendingSendsStore(storage, "test").getSnapshot()[0]?.emission;
`${hq?.hqText} ${hq?.hqService}`
=> true openai

store.restored("hq-2");
store.getSnapshot().length
=> 0

unsubscribe();
```

Preparing HQ is the only phase allowed to replace content under an existing ID.
After final dispatch, that ID's content cannot drift on retry.

```ts continue
store.prepare({ ...emission, id: "hq-work" }, binding);
store.getSnapshot()[0]?.status
=> preparing

store.stage({ ...emission, id: "hq-work", text: "Corrected HQ text", hqText: true, hqService: "hq" }, binding);
store.getSnapshot()[0]?.emission.text
=> Corrected HQ text

store.stage({ ...emission, id: "hq-work", text: "different" }, binding)
=> throws PendingSendChangedError: A saved message cannot change its destination or content

store.accepted("hq-work");
```

An acceptance remains authoritative when storage cleanup fails. The UI receives
an accepted row, with neither Retry nor Restore; if writes still work, that
marker also survives reload. Even a later rejected callback cannot reverse it.

```ts
const data = new Map<string, string>();
let refuseWrites = false;
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { if (refuseWrites) throw new Error("storage disabled"); data.set(key, value); },
  removeItem: () => { throw new Error("remove refused"); },
};
const binding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "chat", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };
const emission: Emission = { id: "accepted", origin: "typed", text: "Sent", images: [], files: [], selections: [], diarized: false };
const store = createPendingSendsStore(storage, "test");
store.stage(emission, binding);
store.accepted(emission.id);
store.getSnapshot()[0]?.status
=> accepted

createPendingSendsStore(storage, "test").getSnapshot()[0]?.status
=> accepted

refuseWrites = true;
store.rejected(emission.id, "late error");
store.getSnapshot()[0]?.status
=> accepted

store.stage(emission, binding)
=> throws PendingSendChangedError: A saved message cannot change its destination or content
```

Unreadable state has an explicit escape: preserve the original bytes, verify
that copy, then reset. A failed preservation write leaves the original alone.
The action never removes a valid saved message and never submits anything.

```ts
const data = new Map<string, string>();
const key = "bbx-pending-web-sends:test";
const raw = '{"version":1,"rows":[broken but potentially recoverable';
data.set(key, raw);
let refuseWrites = true;
const storage = {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { if (refuseWrites) throw new Error("quota"); data.set(key, value); },
  removeItem: (key: string) => { data.delete(key); },
};
quarantineUnreadablePendingSends(storage, "test")
=> throws Error: quota

storage.getItem(key) === raw
=> true

refuseWrites = false;
const fresh = quarantineUnreadablePendingSends(storage, "test");
fresh.getSnapshot().length
=> 0

storage.getItem(key)
=> null

pendingSendRecoveryCopies(storage, "test")[0]?.raw === raw
=> true

const emission: Emission = { id: "new", origin: "typed", text: "A new message", images: [], files: [], selections: [], diarized: false };
const binding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "chat", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };
fresh.stage(emission, binding);
quarantineUnreadablePendingSends(storage, "test").getSnapshot()[0]?.emission.text
=> A new message

pendingSendRecoveryCopies(storage, "test").length
=> 1

// Wrong-box envelopes are also preserved intact, never routed to this box.
data.set(key, JSON.stringify({ version: 1, rows: [{ emission, binding: { ...binding, boxSlug: "other" }, status: "pending" }] }));
quarantineUnreadablePendingSends(storage, "test").getSnapshot().length
=> 0

pendingSendRecoveryCopies(storage, "test").length
=> 2
```

A storage backend silently refusing the preservation write cannot trick recovery
into deleting the only surviving copy.

```ts
const raw = "damaged";
let removed = false;
const storage = {
  getItem: (key: string) => key === "bbx-pending-web-sends:test" ? raw : null,
  setItem: (_key: string, _value: string) => {},
  removeItem: (_key: string) => { removed = true; },
};
quarantineUnreadablePendingSends(storage, "test")
=> throws PendingSendPreservationError

removed
=> false
```
