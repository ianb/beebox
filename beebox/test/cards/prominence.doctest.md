# A card's `prominence` (`shared/prominence.ts`)

`prominence` is who a card is for, and whether the box should surface it to a
reader looking around — not access: every card, at every level, is readable
and addressable. It is a global field with a closed three-value vocabulary
and an absent default; absent means the card type's default level
(`defaultProminence` on `CardSchema`), computed once when a schema is
declared.

```ts setup
import { GLOBAL_CARD_FIELDS } from "../../src/cards/schema.js";
import { Prominence, effectiveLevel } from "../../src/shared/prominence.js";
import { MemoSchema } from "../../src/schemas/memo.js";
import { ChatJobSchema } from "../../src/schemas/chat-job.js";
import { LandmarkSchema } from "../../src/schemas/landmark.js";
```

## It is a global field

```ts
Object.keys(GLOBAL_CARD_FIELDS).join(",")
=> title,contains,contains-evidence,todos,symbol,prominence

GLOBAL_CARD_FIELDS["prominence"].isOptional()
=> true
```

## The three values accept; absence parses as undefined

```ts
Prominence.parse("entry-point")
=> entry-point

Prominence.parse("primary")
=> primary

Prominence.parse("background")
=> background

Prominence.optional().parse(undefined)
=> undefined
```

## A fourth value rejects, naming the three it accepts

A wrong value is a hard error at parse time — the closed enum on a global
field, like every other enum field in the tree — and the message names what
it does accept, so the author can fix it without hunting for the vocabulary.

```ts
const result = Prominence.safeParse("headline");
result.success
=> false

result.error.issues[0].message
=> Invalid option: expected one of "entry-point"|"primary"|"background"
```

## Type defaults: `defaultProminence` on `CardSchema`

A `category: "system"` schema (cards the box writes for its own use, like a
chat job) defaults to `background` with nothing declared per schema — the
category is the declaration.

```ts
ChatJobSchema.category
=> system

ChatJobSchema.defaultProminence
=> background
```

An ordinary authored schema defaults to `ordinary`.

```ts continue
MemoSchema.category
=> authored

MemoSchema.defaultProminence
=> ordinary
```

The landmark schema is `authored`, not `system` — but it declares its own
type default, because a landmark is a place marker rather than a visitable
file: the directory's identity is drawn from it instead of the file ever
being surfaced itself.

```ts continue
LandmarkSchema.category
=> authored

LandmarkSchema.defaultProminence
=> background
```

## `effectiveLevel`: a declared value always wins over the type default

```ts
effectiveLevel({ declared: "primary", typeDefault: ChatJobSchema.defaultProminence })
=> primary

effectiveLevel({ declared: undefined, typeDefault: ChatJobSchema.defaultProminence })
=> background

effectiveLevel({ declared: undefined, typeDefault: MemoSchema.defaultProminence })
=> ordinary
```
