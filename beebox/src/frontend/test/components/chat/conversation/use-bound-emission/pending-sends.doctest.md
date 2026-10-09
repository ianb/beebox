# Pending web sends retain completed content and original destination

Storage is transactional with respect to the live snapshot. A storage failure
prevents staging, so the caller can preserve its draft. The one exception is
the browser's quota refusal: a message too large to save still sends, without
a reload-recovery copy. Reopening a tab never resends a saved message
automatically.

```ts setup
import { createPendingSendsStore, quarantineUnreadablePendingSends, pendingSendRecoveryCopies } from "../../../../../src/components/chat/conversation/use-bound-emission/pending-sends.js";
import { storageScopeFor } from "../../../../../src/lib/storage-scope.js";
import type { Emission } from "../../../../../src/input/emission.js";
import type { SendBinding } from "../../../../../../shared/chat-composer-binding.js";

/** A Map-backed Storage. Set `writeError` to make writes throw; `refuseRemoves` to make removals throw. */
function memoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    data,
    writeError: null as string | null,
    refuseRemoves: false,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.writeError) throw new Error(storage.writeError);
      data.set(key, value);
    },
    removeItem: (key: string) => {
      if (storage.refuseRemoves) throw new Error("remove refused");
      data.delete(key);
    },
  };
  return storage;
}

/** A store over `storage` for box `test` (the default scope). */
const open = (storage, scope?: { boxSlug: string; storageScope: string }) =>
  createPendingSendsStore(storage, scope ?? { boxSlug: "test", storageScope: "test" });

const chatBinding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "chat", contextDir: "" }, attention: { surface: "chat", transcript: "visible" } };
const typed = (id: string, text: string): Emission => ({ id, origin: "typed", text, images: [], files: [], selections: [], diarized: false });
const voice = (id: string): Emission => ({ id, origin: "voice", text: "live words", images: [], files: [], selections: [], diarized: false, spokenStart: 0 });
```

## Staging and recovery

A voice send with an image, a file, a selection and word timings is staged
under a session binding. A storage failure on staging throws, leaves the
snapshot empty and notifies no subscriber, so the caller can preserve its
draft:

```ts
const storage = memoryStorage();
const emission: Emission = { id: "voice-1", origin: "voice", text: "Check [image#1]", diarized: true,
  images: [{ id: 1, mimeType: "image/png", dataBase64: "a".repeat(600_000) }],
  files: [{ id: 2, path: "_tmp/report.pdf", originalName: "report.pdf", mimetype: "application/pdf", size: 512 }],
  selections: [{ id: 3, ref: "/_content/house/Report.doc.card", text: "Quoted evidence", position: "p2", anchor: "check", spokenWords: 1 }],
  words: [{ word: "Check", confidence: 0.9 }], spokenStart: 0,
};
const binding: SendBinding = { boxSlug: "test", target: { kind: "session", sessionId: "kitchen", contextDir: "_content/kitchen" }, attention: { surface: "card", focusedRef: "_content/house/Report.doc.card", transcript: "hidden" } };
const store = open(storage);
let notices = 0;
const unsubscribe = store.subscribe(() => { notices++; });
storage.writeError = "quota";
store.stage(emission, binding)
=> throws Error: quota

({ staged: store.getSnapshot().length, notices })
=> { staged: 0, notices: 0 }
```

Once storage works, the staged send is recovered by a fresh store with its
full content (image bytes, words, selections) and its original destination,
as `recovered` rather than resent. A store for another box sees nothing:

```ts continue
storage.writeError = null;
store.stage(emission, binding);
const row = open(storage).getSnapshot()[0];
({
  status: row?.status,
  imageBytes: row?.emission.images[0]?.dataBase64.length,
  words: row?.emission.words,
  selections: row?.emission.selections,
  sessionId: row?.binding.target.kind === "session" && row.binding.target.sessionId,
  otherBox: open(storage, { boxSlug: "other", storageScope: "other" }).getSnapshot().length,
})
=> {
  status: "recovered",
  imageBytes: 600000,
  words: [{ word: "Check", confidence: 0.9 }],
  selections: [{ id: 3, ref: "/_content/house/Report.doc.card", text: "Quoted evidence", position: "p2", anchor: "check", spokenWords: 1 }],
  sessionId: "kitchen",
  otherBox: 0
}
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

const hq = open(storage).getSnapshot()[0]?.emission;
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
store.prepare({ ...emission, id: "hq-work" }, { binding });
store.getSnapshot()[0]?.status
=> preparing

store.stage({ ...emission, id: "hq-work", text: "Corrected HQ text", hqText: true, hqService: "hq" }, binding);
store.getSnapshot()[0]?.emission.text
=> Corrected HQ text

store.stage({ ...emission, id: "hq-work", text: "different" }, binding)
=> throws PendingSendChangedError: A saved message cannot change its destination or content

store.accepted("hq-work");
```

## A voice send waiting on HQ survives a reload as a visible, unsent item

`prepare` with a `recordingId` marks a voice send that is waiting for its HQ
transcript (`docs/plans/resilient-voice-recording.md`, Track 4). A reload
keeps it as `awaitingHq` rather than `recovered`: the recording and its HQ job
are on the box, and the user chooses which text to send. Loading never sends
it. A `preparing` row without a recording keeps the old recovered path.

```ts
const storage = memoryStorage();
const live = open(storage);
live.prepare(voice("waiting"), { binding: chatBinding, recordingId: "rec-1" });
live.prepare(voice("plain"), { binding: chatBinding });
open(storage).getSnapshot().map((row) => `${row.emission.id}:${row.status}:${row.recordingId ?? "-"}`).join(" ")
=> waiting:awaitingHq:rec-1 plain:recovered:-
```

The user's choice may still replace the realtime snapshot once — here with the
fallback marked `hq="failed"` — and the fallback marker survives storage:

```ts continue
const reloaded = open(storage);
reloaded.stage({ ...voice("waiting"), hqFallback: true }, chatBinding);
open(storage).getSnapshot().find((row) => row.emission.id === "waiting")?.emission.hqFallback
=> true
```

A row saved before late correction was removed may still hold the legacy
`"pending"`/`"failed"` marker on disk; loading normalizes it to `true`:

```ts continue
storage.data.set("bbx-pending-web-sends:test", JSON.stringify({
  version: 1,
  rows: [{ emission: { ...voice("legacy"), hqFallback: "pending" }, binding: chatBinding, status: "pending" }],
}));
open(storage).getSnapshot().find((row) => row.emission.id === "legacy")?.emission.hqFallback
=> true
```

Dismissing an `awaitingHq` item removes it; its recording stays on the box:

```ts
const storage = memoryStorage();
open(storage).prepare(voice("gone"), { binding: chatBinding, recordingId: "rec-2" });
const reloaded = open(storage);
reloaded.dismissed("gone");
reloaded.getSnapshot().length
=> 0
```

## Pending recovery is isolated by API base when worktrees share a box slug

The dev router serves every worktree from one origin. Recovery for `test1` in
one worktree must not load completed sends saved by another worktree, while the
production API base retains the historical `test1` key.

```ts
const storage = memoryStorage();
const paperScope = storageScopeFor("/paper-cards/test1/api");
const chatScope = storageScopeFor("/chat-everywhere/test1/api");
const scoped = (storageScope) => open(storage, { boxSlug: "test1", storageScope });
const test1Binding: SendBinding = { ...chatBinding, boxSlug: "test1" };
scoped(paperScope).stage(typed("paper", "Paper message"), test1Binding);
scoped(chatScope).stage(typed("chat", "Chat message"), test1Binding);
({
  scopes: [paperScope, chatScope, storageScopeFor("/test1/api")],
  paper: scoped(paperScope).getSnapshot().map((row) => row.emission.text),
  chat: scoped(chatScope).getSnapshot().map((row) => row.emission.text),
})
=> { scopes: ["paper-cards/test1", "chat-everywhere/test1", "test1"], paper: ["Paper message"], chat: ["Chat message"] }
```

An acceptance remains authoritative when storage cleanup fails. The UI receives
an accepted row, with neither Retry nor Restore; if writes still work, that
marker also survives reload. Even a later rejected callback cannot reverse it.

```ts
const storage = memoryStorage();
storage.refuseRemoves = true;
const emission = typed("accepted", "Sent");
const store = open(storage);
store.stage(emission, chatBinding);
store.accepted(emission.id);
store.getSnapshot()[0]?.status
=> accepted

open(storage).getSnapshot()[0]?.status
=> accepted

storage.writeError = "storage disabled";
store.rejected(emission.id, "late error");
store.getSnapshot()[0]?.status
=> accepted

store.stage(emission, chatBinding)
=> throws PendingSendChangedError: A saved message cannot change its destination or content
```

Unreadable state has an explicit escape: preserve the original bytes, verify
that copy, then reset. A failed preservation write leaves the original alone.
The action never removes a valid saved message and never submits anything.

```ts
const storage = memoryStorage();
const key = "bbx-pending-web-sends:test";
const raw = '{"version":1,"rows":[broken but potentially recoverable';
storage.data.set(key, raw);
storage.writeError = "quota";
quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" })
=> throws Error: quota

storage.getItem(key) === raw
=> true

storage.writeError = null;
const fresh = quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" });
({ snapshot: fresh.getSnapshot().length, original: storage.getItem(key), copyKeepsRaw: pendingSendRecoveryCopies(storage, "test")[0]?.raw === raw })
=> { snapshot: 0, original: null, copyKeepsRaw: true }

const emission = typed("new", "A new message");
fresh.stage(emission, chatBinding);
quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" }).getSnapshot()[0]?.emission.text
=> A new message

pendingSendRecoveryCopies(storage, "test").length
=> 1

// Wrong-box envelopes are also preserved intact, never routed to this box.
storage.data.set(key, JSON.stringify({ version: 1, rows: [{ emission, binding: { ...chatBinding, boxSlug: "other" }, status: "pending" }] }));
quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" }).getSnapshot().length
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
quarantineUnreadablePendingSends(storage, { boxSlug: "test", storageScope: "test" })
=> throws PendingSendPreservationError

removed
=> false
```

## A message too large to save still sends

The session-storage quota is about 5 MB, so two large photos can exceed it.
A quota refusal does not block the send: the row is kept in this page's
memory (so delivery and its receipt still work) but nothing is written, and
a reload would not recover it.

```ts
const storage = memoryStorage();
storage.setItem = () => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); };
const store = open(storage);
store.stage(typed("big-1", "two large photos"), chatBinding);
({ live: store.getSnapshot().map((row) => [row.emission.id, row.status]), saved: storage.data.size })
=> { live: [["big-1", "pending"]], saved: 0 }
```

Its acceptance then clears it like any other send:

```ts continue
store.accepted("big-1");
store.getSnapshot().length
=> 0
```

## An image's original path survives the recovery copy

The recovery envelope is what a rejected send is retried from, so it has to
carry the uploaded original's `path` or the retry silently goes out with the
pixels and no file line (the storage schema strips keys it does not name).

```ts
const storage = memoryStorage();
const withPath: Emission = { ...typed("img-1", "receipt [image#1]"),
  images: [{ id: 1, mimeType: "image/jpeg", dataBase64: "AA", path: "_tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg" }] };
open(storage).stage(withPath, chatBinding);
open(storage).getSnapshot()[0]?.emission.images[0]?.path
=> _tmp/2026-09-16T10-00-00.000Z_IMG_0001.jpg
```
