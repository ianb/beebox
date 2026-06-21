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
} from "../src/frontend/src/lib/dictation-draft.js";
```

## draftKey

Scopes a draft by box and session. New chats (no server-assigned id yet) share
the `:new` slot; a missing box slug falls back to `default`:

```ts
draftKey({ boxSlug: "test1", sessionId: "sess-abc" })
=> cb-chat-draft:test1:sess-abc

draftKey({ boxSlug: undefined, sessionId: null })
=> cb-chat-draft:default:new
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
