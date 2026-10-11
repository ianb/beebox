# Readable card fields

The generic field renderer shows a card's fields as a person reads them, not
as the file stores them (`docs/plans/readable-card-fields.md`). These two
rules decide it; the Source view keeps the keys and shapes as written.

```ts setup
import { compactValue, fieldLabel, withoutHeaderName } from "../../src/lib/readable-fields.js";
```

## Labels

A key becomes a label: split on `-` and `_`, first letter capitalized. The
rest stays as written, so an abbreviation reads "Ssn"; a better field name or
a custom view fixes that.

```ts
fieldLabel("back-by")
=> Back by

fieldLabel("location")
=> Location

fieldLabel("due_date")
=> Due date

fieldLabel("ssn")
=> Ssn
```

## Identity shapes read as a name

An object with a `name` (or `label`, or `title`) names a thing. Its `ref` is
the link to that thing's card, and `role`, `note`, `notes` are the aside, in
that order.

```ts
compactValue({ name: "Idris", ref: "../people/Idris_Okafor.person.card", role: "lender" })
=> { text: "Idris", ref: "../people/Idris_Okafor.person.card", aside: "lender" }

compactValue({ name: "Idris" })
=> { text: "Idris" }

compactValue({ label: "Kitchen", note: "upstairs" })
=> { text: "Kitchen", aside: "upstairs" }

compactValue({ name: "Idris", role: "lender", notes: "returns on Fridays" })
=> { text: "Idris", aside: "lender, returns on Fridays" }
```

## Plain value shapes read as their text

An object with `text` or `value`, and optionally `note`/`notes`, reads as
the text with the note as the aside.

```ts
compactValue({ value: "1 stove", note: "missing lid" })
=> { text: "1 stove", aside: "missing lid" }

compactValue({ text: "With Idris" })
=> { text: "With Idris" }
```

## Anything else keeps its rows

A `ref` beside `text` can be evidence (a guide observation cites where it
came from), so it is not turned into a link on the text: the object keeps
its own rows.

```ts
compactValue({ text: "Water pools by the door", ref: "../notes/Rain.note.card" })
=> null
```

An extra key would be hidden by a compact value, so the object keeps its
rows. So does an identity shape with a key it does not know (a guide action's
`when`), a non-string part, or two candidate texts.

```ts
compactValue({ value: "3", unit: "spools" })
=> null

compactValue({ name: "Water the ferns", when: "Saturday" })
=> null

compactValue({ value: 3 })
=> null

compactValue({ name: "Idris", title: "Dr." })
=> null

compactValue({ ref: "../people/Idris_Okafor.person.card" })
=> null
```

## The row that repeats the header

A `name` row whose value is the card's header title is dropped before the
fields are framed, so a card with nothing else to show gets no empty field
section. A `name` that differs from the header stays.

```ts
withoutHeaderName({ name: "Camp stove", location: { text: "With Idris" } }, "Camp stove")
=> { location: { text: "With Idris" } }

withoutHeaderName({ name: "Camp stove" }, "Stove")
=> { name: "Camp stove" }
```
