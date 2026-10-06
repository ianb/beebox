# Field maps: `bbx migrate-fields`

A field map (`src/core/card-fields/map.ts`) says how a box's cards move off a
reserved field name: rename the key, or replace each old value with specific
fields. `fieldMapPlanner` turns a map into the same kind of planner the
shipped card-field migrations use, and `applyFieldMap`
(`src/core/card-fields/apply.ts`) runs it over a box.

```ts setup
import { parse, stringify } from "yaml";
import { parseFieldMap, fieldMapPlanner } from "../../../src/core/card-fields/map.js";
import { applyFieldEdits } from "../../../src/core/card-fields/field-edits.js";
import { applyFieldMap } from "../../../src/core/card-fields/apply.js";
import { makeTmpBox } from "../../helpers/doctest-helpers.js";

const map = parseFieldMap(parse(`
types:
  book:
    status: { rename: ownership }
  bill:
    status:
      values:
        paid: { paid: true }
        auto-pay: { auto-pay: true }
        unpaid: {}
    date: { rename: due }
  lesson:
    "segments[].status": { rename: stage }
  docket-entry:
    date: { wrap: { field: filed, key: value } }
  snapshot:
    source: { wrap: { field: sources, key: href, list: true } }
`));
const plan = fieldMapPlanner(map);

function run(type: string, fm: Record<string, unknown>): string {
  const planned = plan(type, fm);
  return JSON.stringify(parse(applyFieldEdits(stringify(fm), planned.edits)));
}

function accepts(raw: unknown): string {
  try {
    parseFieldMap(raw);
    return "accepted";
  } catch (_e) {
    return "rejected";
  }
}

function refusal(type: string, fm: Record<string, unknown>): string {
  try {
    plan(type, fm);
    return "no error";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
```

## A rename keeps the value in the key's place

```ts
run("book", { title: "Dune", status: "owned", pages: 412 })
=> {"title":"Dune","ownership":"owned","pages":412}
```

## A value map replaces the field with the fields each value stands for

`unpaid` maps to nothing, so a card that was unpaid simply loses the field.

```ts
run("bill", { vendor: "Water", status: "paid", date: "2026-10-01" })
=> {"vendor":"Water","paid":true,"due":"2026-10-01"}

run("bill", { vendor: "Water", status: "unpaid", date: "2026-10-01" })
=> {"vendor":"Water","due":"2026-10-01"}
```

## List entries take the `list[].field` form

```ts
run("lesson", { segments: [{ do: "Read", status: "planned" }, { do: "Try", status: "ready" }] })
=> {"segments":[{"do":"Read","stage":"planned"},{"do":"Try","stage":"ready"}]}
```

## Map values take the `map{}.field` form, and a wrong-shaped container is refused

```ts
const perUnit = fieldMapPlanner(parseFieldMap({ types: { progress: { "units{}.status": { rename: "stage" } } } }));
JSON.stringify(parse(applyFieldEdits(stringify({ units: { intro: { status: "done" }, lab: { note: "x" } } }), perUnit("progress", { units: { intro: { status: "done" }, lab: { note: "x" } } }).edits)))
=> {"units":{"intro":{"stage":"done"},"lab":{"note":"x"}}}

refusal("lesson", { segments: { do: "Read", status: "planned" } })
=> lesson segments is not a list; migrate this card by hand

refusal("lesson", { segments: ["Read", { do: "Try", status: "ready" }] })
=> lesson segments[0] status is not a map; migrate this card by hand
```

## A value the card already carries, unchanged, is not a collision

```ts
run("bill", { vendor: "Gas", status: "auto-pay", "auto-pay": true })
=> {"vendor":"Gas","auto-pay":true}
```

## `wrap` turns a scalar into an object, or a one-entry list

A bare date becomes a date entry; a derived-from URL becomes `sources`.

```ts
run("docket-entry", { name: "Petition", date: "2026-03-04" })
=> {"name":"Petition","filed":{"value":"2026-03-04"}}

run("snapshot", { title: "Feed", source: "https://example.com/p/1" })
=> {"title":"Feed","sources":[{"href":"https://example.com/p/1"}]}
```

## Unlisted values and collisions are refused, so a person decides

```ts
refusal("bill", { status: "disputed" })
=> bill status status "disputed" has no safe mapping; migrate this card by hand

refusal("book", { status: "owned", ownership: "wanted" })
=> book ownership has both the old and the new keys; migrate this card by hand
```

`unlisted: drop` opts a field into losing unknown values instead:

```ts
const lenient = fieldMapPlanner(parseFieldMap({ types: { bill: { status: { values: { paid: { paid: true } }, unlisted: "drop" } } } }));
JSON.stringify(lenient("bill", { status: "disputed" }).edits)
=> [{"op":"delete","path":["status"]}]
```

## A malformed map is rejected up front

```ts
accepts({ types: { book: { status: { rename: "ownership", values: {} } } } })
=> rejected

accepts({ types: { book: { status: { rename: "ownership" } } } })
=> accepted
```

## `applyFieldMap` reports each card, and writes only with `apply`

A type the map does not name is never touched; a refused card is reported
and left alone.

```ts
const box = await makeTmpBox();
await box.write("_content/books/Dune.book.card", "---\ntitle: Dune\nstatus: owned\n---\n");
await box.write("_content/books/Odd.book.card", "---\ntitle: Odd\nstatus: owned\nownership: wanted\n---\n");
await box.write("_content/bills/Water.bill.card", "---\nvendor: Water\nstatus: paid\n---\n");
await box.write("_content/Notes.doc.card", "---\ntitle: Notes\nstatus: whatever\n---\nBody.\n");

const dry = await applyFieldMap(box.root, { map, apply: false });
JSON.stringify({ converted: dry.converted, already: dry.already, refused: dry.refused.map((r) => r.path) })
=> {"converted":["_content/bills/Water.bill.card","_content/books/Dune.book.card"],"already":0,"refused":["_content/books/Odd.book.card"]}

(await box.read("_content/books/Dune.book.card")).includes("status: owned")
=> true

const applied = await applyFieldMap(box.root, { map, apply: true });
applied.converted.length
=> 2

JSON.stringify(await box.read("_content/books/Dune.book.card"))
=> "---\ntitle: Dune\nownership: owned\n---\n"

(await applyFieldMap(box.root, { map, apply: true })).converted.length
=> 0
```

```ts cleanup
await box.cleanup();
```
