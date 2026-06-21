# composer-draft helpers

Pure helpers for the unsent-composer draft the chat persists to localStorage so
a remount (the router re-reading search params on wake-from-sleep) or a reload
can't erase typed-but-unsent text. The hook owns the storage I/O and restores
the draft straight into the composer; these own the key shape and the
parse/serialize boundary.

```ts setup
import {
  composerDraftKey,
  parseComposerDraft,
  serializeComposerDraft,
} from "../src/frontend/src/lib/composer-draft.js";
```

## composerDraftKey

Scopes a draft by box and session, on its own key prefix so it never collides
with the voice-dictation draft. New chats (no server-assigned id yet) share the
`:new` slot; a missing box slug falls back to `default`:

```ts
composerDraftKey({ boxSlug: "test1", sessionId: "sess-abc" })
=> cb-composer-draft:test1:sess-abc

composerDraftKey({ boxSlug: undefined, sessionId: null })
=> cb-composer-draft:default:new
```

## serializeComposerDraft / parseComposerDraft

A well-formed draft round-trips, preserving the raw text (whitespace included):

```ts
const draft = { text: "  half-written thought", updatedAt: 5 };
JSON.stringify(parseComposerDraft(serializeComposerDraft(draft)))
=> {"text":"  half-written thought","updatedAt":5}
```

`parseComposerDraft` returns null for anything it can't trust — absent, empty,
blank-text, or malformed-shape values — so a corrupt entry never refills the
composer:

```ts
JSON.stringify(parseComposerDraft(null))
=> null

JSON.stringify(parseComposerDraft(""))
=> null

JSON.stringify(parseComposerDraft("not json"))
=> null
```

```ts
JSON.stringify(parseComposerDraft('{"text":"   ","updatedAt":5}'))
=> null

JSON.stringify(parseComposerDraft('{"text":"hi"}'))
=> null

JSON.stringify(parseComposerDraft('{"text":"hi","updatedAt":"5"}'))
=> null

JSON.stringify(parseComposerDraft('{"updatedAt":5}'))
=> null
```

A complete, correctly-typed record parses:

```ts
JSON.stringify(parseComposerDraft('{"text":"call the dentist","updatedAt":42}'))
=> {"text":"call the dentist","updatedAt":42}
```
