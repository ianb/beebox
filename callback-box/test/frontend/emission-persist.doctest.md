# Emission persistence — singleton key, size gating, legacy adoption

Whole-emission persistence under `cb-input-emission:<box>` — the
composition survives reloads and session switches (the singleton-draft
decision). See docs/plans/input-extraction.md chunk 4.

```ts setup
import {
  emissionKey,
  serializePersistedEmission,
  parsePersistedEmission,
  loadPersistedEmission,
  savePersistedEmission,
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
  files: [{ id: 1, path: "tmp/2026-07-04_report.pdf", originalName: "report.pdf", size: 100, mimetype: "application/pdf" }],
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

loaded?.files[0]?.path
=> tmp/2026-07-04_report.pdf

emissionKey("test1")
=> cb-input-emission:test1

emissionKey(undefined)
=> cb-input-emission:default
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
s.setItem("cb-composer-draft:test1:sess-a", JSON.stringify({ text: "older draft", updatedAt: 100 }));
s.setItem("cb-composer-draft:test1:sess-b", JSON.stringify({ text: "newest draft", updatedAt: 300 }));
s.setItem("cb-composer-draft:test1:sess-c", JSON.stringify({ text: "   ", updatedAt: 900 }));
s.setItem("cb-composer-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", updatedAt: 999 }));
const result = adoptLegacyComposerDrafts(s, "test1");
result.adoptedText
=> newest draft

result.discarded
=> 1

// This box's legacy keys are gone; the other box's are untouched.
Object.keys(s.dump()).sort().join(",")
=> cb-composer-draft:otherbox:sess-z
```

## Restored files partition into live and dead (tmp/ sweeps)

```ts
const files = [
  { id: 1, path: "tmp/alive.pdf", originalName: "a", size: 1, mimetype: "x" },
  { id: 2, path: "tmp/swept.pdf", originalName: "b", size: 1, mimetype: "x" },
];
const { live, dead } = partitionFiles(files, new Set(["tmp/alive.pdf"]));
live.map((f) => f.id).join(",") + " | " + dead.map((f) => f.id).join(",")
=> 1 | 2
```
