# `todo-model.ts` — status enum, date parsing, plate-state derivation

Pure-function doctests for the shared todo vocabulary
(`docs/implemented-plans/todo-annotation.md`, Track 1 chunk 1): the closed status enum,
absolute/relative date parsing, attribute validation, and the box-local
plate-state truth table.

```ts setup
import {
  TODO_STATUSES,
  isTodoStatus,
  parseIsoDate,
  parseRelativeStart,
  resolveStartEpoch,
  validateTodoAttributes,
  deriveTodoPlateState,
  type TodoPlateInput,
} from "../../src/shared/todo-model.js";

function plate(input: TodoPlateInput, now: string, timeZone: string): string {
  return deriveTodoPlateState(input, { now: new Date(now), timeZone });
}

function errIds(attrs: Parameters<typeof validateTodoAttributes>[0]): string {
  const errors = validateTodoAttributes(attrs);
  return errors.length === 0 ? "valid" : errors.map((e) => e.id).join(", ");
}

function noAttrs(overrides: Partial<Parameters<typeof validateTodoAttributes>[0]>) {
  return { by: undefined, created: undefined, due: undefined, start: undefined, ...overrides };
}
```

## Status enum

```ts
JSON.stringify(TODO_STATUSES)
=>
["open","done","dropped","parked"]

isTodoStatus("open")
=> true

isTodoStatus("done")
=> true

isTodoStatus("wontfix")
=> false

isTodoStatus("Open")
=> false
```

## Absolute date parsing

Valid calendar dates parse to a UTC-midnight epoch; malformed shapes and
non-existent calendar dates (Feb 30, month 13) are rejected.

```ts
parseIsoDate("2026-08-01")
=> 1785542400000

parseIsoDate("2026-02-30")
=> null

parseIsoDate("2026-13-01")
=> null

parseIsoDate("08/01/2026")
=> null

parseIsoDate("2026-8-1")
=> null
```

## Relative `start` parsing

```ts
JSON.stringify(parseRelativeStart("-3d"))
=>
{"amount":3,"unit":"d"}

JSON.stringify(parseRelativeStart("-2w"))
=>
{"amount":2,"unit":"w"}

parseRelativeStart("2026-08-01")
=> null

parseRelativeStart("-3m")
=> null

parseRelativeStart("3d")
=> null
```

## Resolving `start` (absolute or relative) against `due`

```ts
resolveStartEpoch("2026-08-01", undefined)
=> 1785542400000

resolveStartEpoch("-3d", "2026-08-01") === parseIsoDate("2026-07-29")
=> true

resolveStartEpoch("-2w", "2026-08-01") === parseIsoDate("2026-07-18")
=> true

resolveStartEpoch("-3d", undefined)
=> null

resolveStartEpoch("not-a-date", "2026-08-01")
=> null
```

## Attribute validation

```ts
errIds(noAttrs({}))
=>
valid

errIds(noAttrs({ created: "2026-07-28", due: "2026-08-01", start: "-3d" }))
=>
valid
```

### Invalid dates

```ts
errIds(noAttrs({ created: "2026-02-30" }))
=>
todo-invalid-created

errIds(noAttrs({ due: "not-a-date" }))
=>
todo-invalid-due

errIds(noAttrs({ start: "next tuesday" }))
=>
todo-invalid-start
```

### Relative `start` requires `due`

```ts
errIds(noAttrs({ start: "-3d" }))
=>
todo-relative-start-requires-due
```

### `start` after `due` (both absolute) is an error

```ts
errIds(noAttrs({ due: "2026-08-01", start: "2026-08-05" }))
=>
todo-start-after-due
```

A relative `start` can never land after `due` by construction (it's always
`due` minus a non-negative interval), so this rule only fires for two
absolute dates.

### `created` required when `by="agent"`

```ts
errIds(noAttrs({ by: "agent" }))
=>
todo-agent-requires-created

errIds(noAttrs({ by: "agent", created: "2026-07-28" }))
=>
valid

errIds(noAttrs({ by: "Dana" }))
=>
valid
```

## Plate-state derivation

Frozen `now` values, box-local timezone. An `open` todo with neither `start`
nor `due` is on the plate immediately (undated = now, per Goal 2 — never a
silent graveyard).

```ts
plate({ status: "open" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
on-plate

plate({ status: "open", due: "2026-08-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
on-plate

plate({ status: "open", due: "2026-07-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
escalated

plate({ status: "open", start: "2026-08-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
quiet

plate({ status: "open", start: "2026-07-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
on-plate

plate({ status: "open", start: "-3d", due: "2026-08-01" }, "2026-07-27T12:00:00Z", "America/Chicago")
=>
quiet

plate({ status: "open", start: "-3d", due: "2026-08-01" }, "2026-07-30T12:00:00Z", "America/Chicago")
=>
on-plate
```

## Non-open statuses are their own terminal plate states

```ts
plate({ status: "done", due: "2026-01-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
done

plate({ status: "dropped" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
dropped

plate({ status: "parked", due: "2026-01-01" }, "2026-07-28T12:00:00Z", "America/Chicago")
=>
parked
```

## Timezone boundary: box-local date, not UTC

`2026-07-28T23:30:00-05:00` is `2026-07-29T04:30:00Z` in UTC, but still
`2026-07-28` in `America/Chicago`. A todo with `due: "2026-07-28"` reads as
due-today (still on-plate, not escalated) in the box's own timezone at that
instant, even though a bare UTC-date comparison would already call it
tomorrow.

`2026-07-29T04:30:00Z` is `2026-07-28 23:30` in `America/Chicago`.

```ts
const nearMidnightLocal = "2026-07-29T04:30:00Z";

plate({ status: "open", due: "2026-07-28" }, nearMidnightLocal, "America/Chicago")
=>
on-plate
```

The same instant, read in UTC (where the calendar date has already rolled
to the 29th), is past that same `due` — escalated:

```ts continue
plate({ status: "open", due: "2026-07-28" }, nearMidnightLocal, "UTC")
=>
escalated
```

A `start` boundary shows the same effect: local Chicago time is still
`2026-07-28`, before an `America/Chicago`-local `start` of `2026-07-29` —
still quiet there — while UTC already reads `2026-07-29`, on the plate.

```ts continue
plate({ status: "open", start: "2026-07-29" }, nearMidnightLocal, "America/Chicago")
=>
quiet

plate({ status: "open", start: "2026-07-29" }, nearMidnightLocal, "UTC")
=>
on-plate
```
