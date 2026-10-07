# The Properties "Changed" line

A card's Properties face names its newest commit as "<how long ago> ·
<subject>", with the commit's full date as the tooltip. It reuses
`formatAgo` (`lib/relative-time.ts`); the caller passes `now`, so the line
is deterministic.

```ts setup
import { lastChangeLine } from "../../src/lib/last-change-line.js";

const now = Date.parse("2026-10-06T12:00:00Z");
```

```ts
lastChangeLine({ date: "2026-10-03T09:30:00Z", subject: "Add porch quotes" }, now)
=> { text: "3 days ago · Add porch quotes", title: "2026-10-03T09:30:00Z" }
```

A commit seconds old reads "just now", and so does a commit dated slightly
ahead of this clock (another machine's clock skew):

```ts
[lastChangeLine({ date: "2026-10-06T11:59:50Z", subject: "Fix typo" }, now).text,
 lastChangeLine({ date: "2026-10-06T12:01:00Z", subject: "Fix typo" }, now).text]
=> ["just now · Fix typo", "just now · Fix typo"]
```

A date that does not parse is shown as written rather than as "NaN days ago",
and so is any date before the component has read the clock (`useNow` starts
at zero to keep render pure):

```ts
[lastChangeLine({ date: "yesterday-ish", subject: "Import" }, now).text,
 lastChangeLine({ date: "2026-10-03T09:30:00Z", subject: "Import" }, null).text]
=> ["yesterday-ish · Import", "2026-10-03T09:30:00Z · Import"]
```
