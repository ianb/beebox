# Moved-card recovery at the file-view boundary

Navigation uses only the typed tRPC recovery value. A display message that
happens to mention a move is not a protocol.

```ts setup
import { cardLoadRecovery, fileChangeAffectsPath } from "../../src/frontend/src/lib/moved-card-recovery.js";
import { resolveLoadState } from "../../src/frontend/src/lib/file-load-state.js";
```

```ts
JSON.stringify(cardLoadRecovery({
  message: "Card not found",
  data: { recovery: { kind: "moved", path: "_content/archive/New.memo.card" } },
}))
=> {"kind":"moved","path":"_content/archive/New.memo.card"}

cardLoadRecovery({ message: "moved to _content/Guess.memo.card" })
=> null

cardLoadRecovery({ data: { recovery: { kind: "moved", path: "not-a-card.md" } } })
=> null
```

A failed live refetch can retain cached content and still carry recovery. The
two decisions are intentionally independent.

```ts
const movedError = {
  message: "Card not found: _content/Old.memo.card",
  data: { recovery: { kind: "moved", path: "_content/New.memo.card" } },
};
const cached = resolveLoadState({
  data: "the old cached body",
  isLoading: false,
  isLoadingError: false,
  isRefetchError: true,
  error: movedError,
});
print(cached.value);
JSON.stringify(cardLoadRecovery(movedError))
=>
the old cached body
{"kind":"moved","path":"_content/New.memo.card"}
```

An exact file event always refreshes the open file. An ancestor event matters
only when it is a rename, which covers a whole directory moving without making
ordinary directory writes refetch every descendant.

```ts
fileChangeAffectsPath(
  { event: "change", path: "/_content/session/Note.memo.card" },
  "_content/session/Note.memo.card",
)
=> true

fileChangeAffectsPath(
  { event: "rename", path: "_content/session" },
  "_content/session/Note.memo.card",
)
=> true

fileChangeAffectsPath(
  { event: "change", path: "_content/session" },
  "_content/session/Note.memo.card",
)
=> false

fileChangeAffectsPath(
  { event: "rename", path: "_content/sess" },
  "_content/session/Note.memo.card",
)
=> false
```
