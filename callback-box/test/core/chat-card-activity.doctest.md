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
  renderActivityChildren,
  mergeCardStateDetails,
} from "../../src/core/chat-card-activity.js";
import { combineQueuedInputs } from "../../src/core/chat-session-state.js";
```

## Recognizing kinds

```ts
isActivityKind("modified")
=> true

isActivityKind("clicked")
=> false
```

## Rendering the snapshot children

`renderActivityChildren` emits one `<card-activity>` element per kind, in
canonical order, dropping unrecognized kinds. A kind with a detail carries it as
element text (XML-escaped); without one it's self-closing. Empty input renders
`""` so the caller keeps `<chat-app>` self-closing.

Two kinds are suppressed as redundant noise: a detail-less `scrolled` (it has no
*where*), and a `navigated` whose target is the card already named by `openCard`.

```ts
// scrolled carries no detail today, so it's dropped rather than emitted bare
JSON.stringify(renderActivityChildren({ kinds: ["scrolled"], details: {} }))
=> ""

renderActivityChildren({ kinds: ["explored"], details: { explored: "boat-water+road -> boats" } })
=> <card-activity kind="explored">boat-water+road -> boats</card-activity>

JSON.stringify(renderActivityChildren({ kinds: [], details: {} }))
=> ""

JSON.stringify(renderActivityChildren({ kinds: ["bogus"], details: {} }))
=> ""
```

`navigated` is dropped when it just restates the open card, and kept when it
points somewhere else.

```ts
// redundant with the open-card attribute → suppressed
JSON.stringify(renderActivityChildren({
  kinds: ["navigated"],
  details: { navigated: "store/a.card" },
  openCard: "store/a.card",
}))
=> ""

renderActivityChildren({
  kinds: ["navigated"],
  details: { navigated: "store/b.card" },
  openCard: "store/a.card",
})
=> <card-activity kind="navigated">store/b.card</card-activity>
```

Multiple kinds come out in canonical order regardless of arrival order, one per
line; detail text is escaped. The detail-less `scrolled` here is suppressed,
leaving only the useful `explored`.

```ts
JSON.stringify(renderActivityChildren({ kinds: ["explored", "scrolled"], details: { explored: "a < b & c" } }))
=> "<card-activity kind=\"explored\">a &lt; b &amp; c</card-activity>"
```

## Unioning across queued sends

`unionActivityKinds` merges several lists into one canonical-ordered list,
dropping unrecognized kinds. It backs the queued-send combine so an earlier
queued message's activity is never lost.

```ts
JSON.stringify(unionActivityKinds([["scrolled"], ["modified"], undefined]))
=> ["scrolled","modified"]

JSON.stringify(unionActivityKinds([["modified", "navigated"], ["modified"]]))
=> ["navigated","modified"]

JSON.stringify(unionActivityKinds([]))
=> []
```

## Per-kind detail (card-state)

`reportActivity(kind, detail)` attaches a free-text detail per kind, carried as
the `<card-activity>` element text. `mergeCardStateDetails` merges detail maps
latest-wins per kind, dropping unrecognized kinds and empty strings — so a later
queued send's detail for a kind overrides an earlier one.

```ts
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

```ts
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

```ts
const plain = combineQueuedInputs([{ text: "a" }, { text: "b" }]);
JSON.stringify(plain.openCard ?? null)
=> null

JSON.stringify(plain.cardActivity ?? null)
=> null
```
