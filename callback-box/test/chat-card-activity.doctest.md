# Companion-pane card activity

`src/core/chat-card-activity.ts` holds the vocabulary for what the user did to
the card open in the chat's two-pane companion layout. The four kinds project
onto a canonical order (`scrolled`, `navigated`, `explored`, `modified`) for
both the snapshot attribute and the queued-send union.

```ts setup
import {
  isActivityKind,
  joinActivityKinds,
  unionActivityKinds,
  formatCardState,
  mergeCardStateDetails,
} from "../src/core/chat-card-activity.js";
import { combineQueuedInputs } from "../src/core/chat-session-state.js";
```

## Recognizing kinds

```
isActivityKind("modified")
=> true

isActivityKind("clicked")
=> false
```

## Joining for the snapshot attribute

`joinActivityKinds` de-duplicates, drops unrecognized kinds, and emits the
canonical order regardless of arrival order. Empty input collapses to
`undefined` so the attribute is omitted (the snapshot pipeline renders empty
strings, so the caller must pass `undefined`, not `""`).

```
joinActivityKinds(["modified", "scrolled", "modified"])
=> scrolled,modified

joinActivityKinds(["explored", "bogus", "navigated"])
=> navigated,explored

JSON.stringify(joinActivityKinds([]))
=> undefined

JSON.stringify(joinActivityKinds(["bogus"]))
=> undefined
```

## Unioning across queued sends

`unionActivityKinds` merges several lists into one canonical-ordered list,
dropping unrecognized kinds. It backs the queued-send combine so an earlier
queued message's activity is never lost.

```
JSON.stringify(unionActivityKinds([["scrolled"], ["modified"], undefined]))
=> ["scrolled","modified"]

JSON.stringify(unionActivityKinds([["modified", "navigated"], ["modified"]]))
=> ["navigated","modified"]

JSON.stringify(unionActivityKinds([]))
=> []
```

## Per-kind detail (card-state)

`reportActivity(kind, detail)` attaches a free-text detail per kind. `formatCardState`
renders the details as `kind: detail` pairs in canonical order, joined by `; `;
empty input collapses to `undefined` so the attribute is omitted.

```
formatCardState({ explored: "boat-water+road → boats" })
=> explored: boat-water+road → boats

formatCardState({ modified: "store/Trip.memo.card", explored: "king-man+woman → queen" })
=> explored: king-man+woman → queen; modified: store/Trip.memo.card

JSON.stringify(formatCardState({}))
=> undefined

JSON.stringify(formatCardState({ explored: "" }))
=> undefined
```

`mergeCardStateDetails` merges detail maps latest-wins per kind, dropping
unrecognized kinds and empty strings — so a later queued send's detail for a
kind overrides an earlier one.

```
JSON.stringify(mergeCardStateDetails([
  { explored: "boa" },
  { explored: "boat", modified: "x.card" },
]))
=> {"explored":"boat","modified":"x.card"}

JSON.stringify(mergeCardStateDetails([{ bogus: "y" }, { explored: "" }]))
=> {}
```

## Combining queued inputs

`combineQueuedInputs` joins text, renumbers image tokens, and for the
companion-pane fields takes the **latest** `openCard` (where the user is now)
but the **union** of `cardActivity` — a later send reporting only "modified"
must not clobber an earlier "scrolled".

```
const combined = combineQueuedInputs([
  { text: "first", openCard: "a.card", cardActivity: ["scrolled", "explored"], cardState: { explored: "bo" } },
  { text: "second", openCard: "b.card", cardActivity: ["modified"], cardState: { explored: "boat" } },
]);
JSON.stringify(combined.text)
=> "first\n\nsecond"

combined.openCard
=> b.card

JSON.stringify(combined.cardActivity)
=> ["scrolled","explored","modified"]

JSON.stringify(combined.cardState)
=> {"explored":"boat"}
```

When no queued send carries companion-pane state, both fields are absent (not
empty) so the snapshot omits them.

```
const plain = combineQueuedInputs([{ text: "a" }, { text: "b" }]);
JSON.stringify(plain.openCard ?? null)
=> null

JSON.stringify(plain.cardActivity ?? null)
=> null
```
