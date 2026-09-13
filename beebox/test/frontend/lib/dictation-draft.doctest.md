# dictation-draft helpers

Pure helpers for the interrupted-dictation draft the chat persists to
localStorage so a screen sleep / tab eviction / reload can't erase an
in-progress narration transcript. The hook owns the storage I/O; these own the
key shape and the parse/serialize boundary. The age label moved to
`relative-time.doctest.md`, where the capture chip shares it.

```ts setup
import {
  draftKey,
  parseDraft,
  serializeDraft,
  adoptLegacyDictationDrafts,
} from "../../../src/frontend/src/lib/dictation-draft.js";
import type { KeyValueStorage } from "../../../src/frontend/src/input/emission-persist.js";

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
```

## draftKey

One singleton slot per box (docs/plans/input-extraction.md, chunk 4) — not
per session, mirroring the composer's `emissionKey`. A missing box slug falls
back to `default`:

```ts
draftKey({ boxSlug: "test1", scope: "" })
=> bbx-chat-draft:test1:singleton

draftKey({ boxSlug: undefined, scope: "" })
=> bbx-chat-draft:default:singleton
```

The slot is per box INSTANCE, mirroring the composer: two dev worktrees serving
their own `test1` from one origin must not share a dictation draft. Production's
scope is empty and its key is unchanged.

```ts
JSON.stringify([
  draftKey({ boxSlug: "test1", scope: "main/test1" }),
  draftKey({ boxSlug: "test1", scope: "" }),
])
=> ["bbx-chat-draft:main/test1:singleton","bbx-chat-draft:test1:singleton"]
```

## adoptLegacyDictationDrafts: most-recent wins, all legacy keys removed

The named behavior change (mirrors `adoptLegacyComposerDrafts`): other
sessions' stale dictation drafts are discarded, not merged.

```ts
const s = fakeStorage();
s.setItem("bbx-chat-draft:test1:sess-a", JSON.stringify({ text: "older", narration: false, updatedAt: 100 }));
s.setItem("bbx-chat-draft:test1:sess-b", JSON.stringify({ text: "newest", narration: true, updatedAt: 300 }));
s.setItem("bbx-chat-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", narration: false, updatedAt: 999 }));
const result = adoptLegacyDictationDrafts(s, { boxSlug: "test1", scope: "" });
JSON.stringify(result.adopted)
=> {"text":"newest","narration":true,"updatedAt":300}

result.discarded
=> 1

// This box's legacy keys are gone; the other box's are untouched.
Object.keys(s.dump()).sort().join(",")
=> bbx-chat-draft:otherbox:sess-z
```

An empty box (no legacy keys, or none that parse) adopts nothing:

```ts
const empty = fakeStorage();
const result2 = adoptLegacyDictationDrafts(empty, { boxSlug: "test1", scope: "" });
JSON.stringify(result2)
=> {"adopted":null,"discarded":0}
```

The singleton key itself is never a candidate — it uses the new prefix,
separate from the legacy per-session prefix, and adoption must not delete or
re-adopt the slot it writes to:

```ts
const s2 = fakeStorage();
s2.setItem("bbx-chat-draft:test1:singleton", "not json {{{");
s2.setItem("bbx-chat-draft:test1:sess-a", JSON.stringify({ text: "legacy", narration: false, updatedAt: 100 }));
const result3 = adoptLegacyDictationDrafts(s2, { boxSlug: "test1", scope: "" });
JSON.stringify(result3.adopted)
=> {"text":"legacy","narration":false,"updatedAt":100}

// The malformed singleton survives (the caller overwrites it); only the legacy key is removed.
Object.keys(s2.dump()).sort().join(",")
=> bbx-chat-draft:test1:singleton
```

## serializeDraft / parseDraft

A well-formed draft round-trips:

```ts
const draft = { text: "buy oat milk and call the dentist", narration: true, updatedAt: 5 };
JSON.stringify(parseDraft(serializeDraft(draft)))
=> {"text":"buy oat milk and call the dentist","narration":true,"updatedAt":5}
```

`parseDraft` returns null for anything it can't trust — absent, empty, or
malformed-shape values — so a corrupt entry never reaches the UI:

```ts
JSON.stringify(parseDraft(null))
=> null

JSON.stringify(parseDraft(""))
=> null
```

```ts
JSON.stringify(parseDraft('{"text":"   ","narration":true,"updatedAt":5}'))
=> null

JSON.stringify(parseDraft('{"text":"hi","narration":"yes","updatedAt":5}'))
=> null

JSON.stringify(parseDraft('{"text":"hi","narration":true}'))
=> null

JSON.stringify(parseDraft('{"text":"hi","narration":true,"updatedAt":"5"}'))
=> null
```

A complete, correctly-typed record parses:

```ts
JSON.stringify(parseDraft('{"text":"hi","narration":false,"updatedAt":42}'))
=> {"text":"hi","narration":false,"updatedAt":42}
```
