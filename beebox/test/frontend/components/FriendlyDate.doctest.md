# FriendlyDate — date-only strings are calendar days, not instants

`new Date("2026-08-14")` parses as UTC midnight, so formatting it in the
browser's zone renders the *previous* day anywhere behind UTC — a todo due
`2026-08-14` showed as "due Aug 13, 2026" on the Plate in US timezones.
`formatOptions` pins date-only values to UTC (and drops the time) so the day
shown is the day written; full timestamps keep local-zone formatting.

```ts setup
import { formatOptions } from "../../../src/frontend/src/components/ui/FriendlyDate.js";
```

A date-only string formats in UTC regardless of `mode`, so the rendered day
matches the written day in every runner timezone:

```ts
formatOptions({ iso: "2026-08-14", mode: "date" }).timeZone
=> UTC

new Date("2026-08-14").toLocaleString("en-US", formatOptions({ iso: "2026-08-14", mode: "date" }))
=> Aug 14, 2026

formatOptions({ iso: "2026-08-14" }).timeStyle === undefined
=> true
```

The counterfactual this guards against — the same parse formatted in a
behind-UTC zone lands on the previous calendar day:

```ts
new Date("2026-08-14").toLocaleString("en-US", { dateStyle: "medium", timeZone: "America/Chicago" })
=> Aug 13, 2026
```

Full timestamps are instants and keep the viewer's local zone (no `timeZone`
pin), with time shown unless `mode: "date"`:

```ts
const full = formatOptions({ iso: "2026-08-14T10:00:00Z" });
[String(full.timeZone), String(full.timeStyle)].join(" ")
=> undefined short

formatOptions({ iso: "2026-08-14T10:00:00Z", mode: "date" }).timeStyle === undefined
=> true
```
