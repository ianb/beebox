# The date entry

`DateEntrySchema` (`src/cards/date-entry.ts`, exported from `beebox/cards`) is
one date that belongs to a card's subject: `{ value, kind?, end?, note? }`.
`value` and `end` are ISO 8601 at whatever precision is known. See the
Ontology in `docs/implemented-plans/standard-card-fields.md`.

```ts setup
import { z } from "zod";
import { DateEntrySchema, cardSchema } from "../../src/exports/cards.js";
import { parseCardText } from "../../src/core/card-io.js";
import { createCardSchemaMap } from "../../src/schemas.js";

// What loading fails with, or "loaded".
function rejection(load: (text: string) => unknown, text: string): string {
  try {
    load(text);
    return "loaded";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function check(entry: unknown): string {
  const result = DateEntrySchema.safeParse(entry);
  return result.success ? "ok" : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}
```

## A value at any precision, a range, and a named kind

```ts
[
  { value: "1974" },
  { value: "1974-06" },
  { value: "1974-06-02", note: "Postmark" },
  { value: "2026-09-28T09:30:00-05:00", kind: "starts" },
  { value: "2026-09-28T14:30Z", kind: "due" },
  { value: "2026-03-01", end: "2026-03-15", kind: "filed" },
].map(check).join(", ")
=> ok, ok, ok, ok, ok, ok
```

Free text, an impossible month, and a time without an offset are refused:

```ts
check({ value: "circa 1970" })
=> value: expected an ISO 8601 date: YYYY, YYYY-MM, YYYY-MM-DD, or a date and time with an offset

check({ value: "1974-13" })
=> value: expected an ISO 8601 date: YYYY, YYYY-MM, YYYY-MM-DD, or a date and time with an offset

check({ value: "2026-09-28", end: "2026-09-28T09:30" })
=> end: expected an ISO 8601 date: YYYY, YYYY-MM, YYYY-MM-DD, or a date and time with an offset
```

## A box-local schema uses it for one named date or a list

```ts
const bill = cardSchema("bill-fixture", {
  fields: { payee: z.string(), due: DateEntrySchema, dates: z.array(DateEntrySchema).optional() },
});
const schemas = new Map([["bill-fixture", bill]]);
const card = parseCardText("---\npayee: Water utility\ndue:\n  value: 2026-10-15\ndates:\n  - value: 2026-09-20\n    kind: issued\n---\n", { source: "water.bill-fixture.card", schemas });
JSON.stringify([card.fields["due"], card.fields["dates"]])
=> [{"value":"2026-10-15"},[{"value":"2026-09-20","kind":"issued"}]]
```

## record's `dates` take the entry, with `value` still free text

Records hold dates transcribed from old documents, and some are not dates
ISO 8601 can state, so a record's `value` is not format-checked; `end` is. A
bare year is a YAML number, so it is quoted (`value: "1974"`).

```ts
const builtIns = await createCardSchemaMap();
const record = (dates: string) => parseCardText(`---\nname: Letter\ndates:\n${dates}---\n`, { source: "letter.record.card", schemas: builtIns });
JSON.stringify(record("  - value: 1970s\n    note: Guessed from the car\n  - value: 1974-06\n    end: 1974-08\n    kind: written\n").fields["dates"])
=> [{"value":"1970s","note":"Guessed from the car"},{"value":"1974-06","kind":"written","end":"1974-08"}]

rejection(record, "  - value: \"1974\"\n    end: summer\n")
=> letter.record.card: invalid record frontmatter:
  - dates[0].end: expected an ISO 8601 date: YYYY, YYYY-MM, YYYY-MM-DD, or a date and time with an offset
```
