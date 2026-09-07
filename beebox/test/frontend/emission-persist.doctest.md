# Emission persistence — singleton key, size gating, legacy adoption

Whole-emission persistence under `bbx-input-emission:<box>` — the
composition survives reloads and session switches (the singleton-draft
decision). See docs/plans/input-extraction.md chunk 4.

```ts setup
import {
  emissionKey,
  serializePersistedEmission,
  parsePersistedEmission,
  loadPersistedEmission,
  savePersistedEmission,
  commitPersistedEmission,
  isEmptyEmissionDraft,
  adoptLegacyComposerDrafts,
  partitionFiles,
  PERSIST_BYTE_BUDGET,
  type KeyValueStorage,
} from "../../src/frontend/src/input/emission-persist.js";

function fakeStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    dump: () => Object.fromEntries(m),
  };
}

const draft = {
  text: "half a thought [file1]",
  images: [],
  files: [{ id: 1, originalName: "report.pdf", size: 100, mimetype: "application/pdf", state: { status: "uploaded", path: "_tmp/2026-07-04_report.pdf" } }],
  selections: [],
};
```

## Round-trip under the singleton key

```ts
const s = fakeStorage();
savePersistedEmission(s, { boxSlug: "test1", draft, updatedAt: 1000 });
const loaded = loadPersistedEmission(s, "test1");
loaded?.text
=> half a thought [file1]

JSON.stringify(loaded?.files[0]?.state)
=> {"status":"uploaded","path":"_tmp/2026-07-04_report.pdf"}

emissionKey("test1")
=> bbx-input-emission:test1

emissionKey(undefined)
=> bbx-input-emission:default
```

## A send empties the composer, and the key goes with it

`commitPersistedEmission` is what the persistence hook runs on every store
change. An empty draft — what every send site leaves behind once text,
attachments, and selections are cleared — REMOVES the key rather than
rewriting it empty, and the hook runs this synchronously instead of on the
400ms debounce. That is the fix for
issues/bugs/2026-07-23-voice-send-lingers-as-unsent-recovery-draft.md: a
debounced clear lost its race with an in-app navigation, so the pre-send
draft survived and was offered back as "unsent".

```ts
const s = fakeStorage();
const empty = { text: "", images: [], files: [], selections: [] };

// Dictating persists a draft…
commitPersistedEmission(s, { boxSlug: "test1", draft: { ...draft, text: "send this please" }, updatedAt: 1000 });
Object.keys(s.dump()).join(",")
=> bbx-input-emission:test1

// …and the send that empties the store takes the key with it. No window.
commitPersistedEmission(s, { boxSlug: "test1", draft: empty, updatedAt: 2000 });
Object.keys(s.dump()).length + " keys | recovery offers: " + JSON.stringify(loadPersistedEmission(s, "test1"))
=> 0 keys | recovery offers: null

// Emptiness is all four slices, not just the text.
isEmptyEmissionDraft(empty) + "," + isEmptyEmissionDraft({ ...empty, text: "x" }) + "," + isEmptyEmissionDraft(draft)
=> true,false,false

// A non-empty draft still saves normally (that's the debounced typing path).
commitPersistedEmission(s, { boxSlug: "test1", draft, updatedAt: 3000 });
loadPersistedEmission(s, "test1")?.text
=> half a thought [file1]
```

## Oversized images are dropped from persistence, not from memory

```ts
const big = { ...draft, images: [{ id: 1, mimeType: "image/png", dataBase64: "x".repeat(PERSIST_BYTE_BUDGET), objectUrl: "blob:x", byteLength: PERSIST_BYTE_BUDGET }] };
const { payload, imagesDropped } = serializePersistedEmission(big, { updatedAt: 1 });
imagesDropped
=> true

const restored = parsePersistedEmission(payload);
restored !== null && restored.images.length === 0 && restored.text === draft.text
=> true
```

## Corrupt or absent payloads read as empty, never throw

```ts
parsePersistedEmission("not json {{{")
=> null

parsePersistedEmission(JSON.stringify({ version: 99, text: "future" }))
=> null

parsePersistedEmission(null)
=> null
```

## Legacy adoption: most-recent wins, all old keys removed

The named behavior change: other sessions' stale drafts are discarded,
not merged.

```ts
const s = fakeStorage();
s.setItem("bbx-composer-draft:test1:sess-a", JSON.stringify({ text: "older draft", updatedAt: 100 }));
s.setItem("bbx-composer-draft:test1:sess-b", JSON.stringify({ text: "newest draft", updatedAt: 300 }));
s.setItem("bbx-composer-draft:test1:sess-c", JSON.stringify({ text: "   ", updatedAt: 900 }));
s.setItem("bbx-composer-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", updatedAt: 999 }));
const result = adoptLegacyComposerDrafts(s, "test1");
result.adoptedText
=> newest draft

result.discarded
=> 1

// This box's legacy keys are gone; the other box's are untouched.
Object.keys(s.dump()).sort().join(",")
=> bbx-composer-draft:otherbox:sess-z
```

## An unfinished upload is persisted, so restore can strip its token

A file's `[file#N]` token enters the composer text the moment it is picked,
before its bytes move. If a save dropped the still-uploading entry, the token
would survive in the saved text with nothing to explain it — no chip, no
expired note, and an id `reserveIds` never covers, so the next attachment could
mint that id and adopt the orphan token. Persisting it keeps the two halves
together; `partitionFiles` then finds it pathless and classes it dead, which is
what strips the token on the way back in.

```ts
const uploading = { id: 2, originalName: "big.pdf", size: 9, mimetype: "application/pdf", state: { status: "uploading", progress: 0.4 } } as const;
const midUpload = { ...draft, text: "half a thought [file#1] [file#2]", files: [...draft.files, uploading] };
const s2 = fakeStorage();
savePersistedEmission(s2, { boxSlug: "test1", draft: midUpload, updatedAt: 2000 });
JSON.stringify(loadPersistedEmission(s2, "test1")?.files.map((f) => [f.id, f.state.status]))
=> [[1,"uploaded"],[2,"uploading"]]
```

```ts continue
const { live, dead } = partitionFiles(
  loadPersistedEmission(s2, "test1")?.files ?? [],
  new Set(["_tmp/2026-07-04_report.pdf"]),
);
JSON.stringify({ live: live.map((f) => f.id), dead: dead.map((f) => f.id) })
=> {"live":[1],"dead":[2]}
```

## Restored files partition into live and dead (_tmp/ sweeps)

```ts
const uploaded = (id: number, path: string) =>
  ({ id, originalName: "f", size: 1, mimetype: "x", state: { status: "uploaded", path } }) as const;
const files = [uploaded(1, "_tmp/alive.pdf"), uploaded(2, "_tmp/swept.pdf")];
const { live, dead } = partitionFiles(files, new Set(["_tmp/alive.pdf"]));
live.map((f) => f.id).join(",") + " | " + dead.map((f) => f.id).join(",")
=> 1 | 2
```
