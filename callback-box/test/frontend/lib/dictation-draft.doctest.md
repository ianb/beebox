# dictation-draft helpers

Pure helpers for the interrupted-dictation draft the chat persists to
localStorage so a screen sleep / tab eviction / reload can't erase an
in-progress narration transcript. The hook owns the storage I/O; these own the
key shape, the parse/serialize boundary, and the age label.

```ts setup
import {
  draftKey,
  parseDraft,
  serializeDraft,
  formatDraftAge,
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
draftKey({ boxSlug: "test1" })
=> cb-chat-draft:test1:singleton

draftKey({ boxSlug: undefined })
=> cb-chat-draft:default:singleton
```

## adoptLegacyDictationDrafts: most-recent wins, all legacy keys removed

The named behavior change (mirrors `adoptLegacyComposerDrafts`): other
sessions' stale dictation drafts are discarded, not merged.

```ts
const s = fakeStorage();
s.setItem("cb-chat-draft:test1:sess-a", JSON.stringify({ text: "older", narration: false, updatedAt: 100 }));
s.setItem("cb-chat-draft:test1:sess-b", JSON.stringify({ text: "newest", narration: true, updatedAt: 300 }));
s.setItem("cb-chat-draft:otherbox:sess-z", JSON.stringify({ text: "not ours", narration: false, updatedAt: 999 }));
const result = adoptLegacyDictationDrafts(s, "test1");
JSON.stringify(result.adopted)
=> {"text":"newest","narration":true,"updatedAt":300}

result.discarded
=> 1

// This box's legacy keys are gone; the other box's are untouched.
Object.keys(s.dump()).sort().join(",")
=> cb-chat-draft:otherbox:sess-z
```

An empty box (no legacy keys, or none that parse) adopts nothing:

```ts
const empty = fakeStorage();
const result2 = adoptLegacyDictationDrafts(empty, "test1");
JSON.stringify(result2)
=> {"adopted":null,"discarded":0}
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

## formatDraftAge

Renders the elapsed-since-capture label from milliseconds (the caller owns the
clock, so this stays deterministic). Anything under ~45s reads "just now":

```ts
formatDraftAge(0)
=> just now

formatDraftAge(10_000)
=> just now
```

Minutes, hours, and days, with singular/plural days:

```ts
formatDraftAge(60_000)
=> 1 min ago

formatDraftAge(3 * 60_000)
=> 3 min ago

formatDraftAge(60 * 60_000)
=> 1 hr ago

formatDraftAge(3 * 60 * 60_000)
=> 3 hr ago

formatDraftAge(24 * 60 * 60_000)
=> 1 day ago

formatDraftAge(48 * 60 * 60_000)
=> 2 days ago
```
