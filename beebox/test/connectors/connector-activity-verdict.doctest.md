# Connector activity verdict

`connectorVerdict` decides from a connector's activity record whether it has
gone quiet or keeps failing. A false alarm on a real box is worse than
silence, so every rule below errs toward saying nothing.

Histories here are written one character per box-local day, oldest first,
ending on `today`:

- `P` — synced successfully and brought in new items
- `Z` — synced successfully, nothing new
- `E` — every sync that day errored
- `S` — every sync that day was skipped (service off, no credential)
- `.` — no sync ran that day

```ts setup
import { connectorVerdict, nextEpisode, describeVerdict } from "../../src/connectors/activity-verdict.js";
import { addDays } from "../../src/connectors/activity.js";

const today = "2026-09-18";

/** Days ending on `end` (default `today`). */
function history(pattern: string, end = today) {
  const days = {};
  const chars = [...pattern];
  chars.forEach((char, i) => {
    const day = addDays(end, i - (chars.length - 1));
    const base = { runs: 1, ok: 0, newItems: 0, created: 0, updated: 0, errored: 0, skipped: 0, lastError: null };
    if (char === "P") days[day] = { ...base, ok: 1, newItems: 12, created: 30 };
    if (char === "Z") days[day] = { ...base, ok: 1, updated: 3 };
    if (char === "E") days[day] = { ...base, errored: 1, lastError: "invalid_grant" };
    if (char === "S") days[day] = { ...base, skipped: 1 };
  });
  return days;
}

function verdict(pattern: string, openEpisode = null) {
  const v = connectorVerdict({ days: history(pattern), today, openEpisode });
  return v.kind === "quiet" ? `quiet since ${v.since}: ${v.quietDays} of ${v.allowedDays}`
    : v.kind === "failing" ? `failing since ${v.since}: ${v.failingDays} days`
    : v.kind;
}

const daily = "P".repeat(35);
```

## The anchor incident: a daily producer stops bringing in new items

Five weeks of new mail every day, then syncs keep succeeding (refreshing tracked
threads) with nothing new. Two quiet days are allowed; the third alerts.

```ts
verdict(daily + "ZZ")
=> healthy

verdict(daily + "ZZZ")
=> quiet since 2026-09-16: 3 of 2

verdict(daily + "ZZZZZ")
=> quiet since 2026-09-14: 5 of 2
```

## Days with no syncs count for nothing

A scheduler outage in the middle of a quiet stretch neither extends it nor
breaks it. A week off followed by one quiet day is one quiet day:

```ts
verdict(daily + ".......Z")
=> healthy

verdict(daily + "Z.......ZZ")
=> quiet since 2026-09-09: 3 of 2
```

## Sparse and irregular connectors are never watched

New items on fewer than 60% of the 28 calendar days before the quiet stretch
means the connector is not a steady producer. A Monday/Wednesday/Friday
connector produces on at most 12 of 28 days, however regular it is:

```ts
verdict("P.P.P..".repeat(5) + "Z.Z.Z..Z.Z.Z..")
=> unwatched

verdict("PZZZZZZ".repeat(5) + "ZZZZZZZZZZZZZZ")
=> unwatched
```

Nor is a connector with under 21 days of history:

```ts
verdict("P".repeat(15) + "ZZZZZ")
=> unwatched
```

## A connector with gaps gets a longer allowance

The allowance is twice the longest quiet run in the baseline. A connector that
routinely skips two days at a time may be quiet for four:

```ts
const gappy = "ZZPPPPP".repeat(5);
verdict(gappy + "ZZZZ")
=> healthy

verdict(gappy + "ZZZZZ")
=> quiet since 2026-09-14: 5 of 4
```

## Errors and skips are not quiet days

A day whose syncs all errored or skipped is passed over by the quiet count.
Errors have their own verdict; a skip already says why nothing ran.

```ts
verdict(daily + "ZSSSSZ")
=> healthy

verdict(daily + "ZE")
=> healthy

verdict(daily + "ZEE")
=> failing since 2026-09-17: 2 days
```

A connector that fails every sync for two run days is failing, whatever its
history, and an ok day ends it:

```ts
verdict("EE")
=> failing since 2026-09-17: 2 days

verdict("E.....E")
=> failing since 2026-09-12: 2 days

verdict("EEEP")
=> healthy
```

## New items clear the verdict

```ts
verdict(daily + "ZZZZP")
=> healthy
```

## An open episode does not age out

Two months into a quiet stretch, the baseline has left the 60-day record. With
no open episode the connector would read as unwatched and its warning would
vanish on its own. The stored episode keeps it quiet until new items arrive:

```ts
const longQuiet = "Z".repeat(60);
verdict(longQuiet)
=> unwatched

verdict(longQuiet, { kind: "quiet", since: "2026-06-01" })
=> quiet since 2026-06-01: 60 of null

verdict(longQuiet + "P", { kind: "quiet", since: "2026-06-01" })
=> healthy
```

## Episodes persist their notification and dismissal

`nextEpisode` keeps the stored episode while the same one continues, so a sent
notification is not sent again and a dismissal sticks. A cleared condition
drops it, and the next episode starts fresh.

```ts
const quiet = connectorVerdict({ days: history(daily + "ZZZ"), today, openEpisode: null });
const first = nextEpisode(null, quiet);
JSON.stringify(first)
=> {"kind":"quiet","since":"2026-09-16","notifiedAt":null,"dismissedAt":null}

const dismissed = { ...first, notifiedAt: "2026-09-18T12:00:00.000Z", dismissedAt: "2026-09-18T13:00:00.000Z" };
// The next day: same history plus one more quiet day.
const tomorrow = addDays(today, 1);
const longer = connectorVerdict({ days: history(daily + "ZZZZ", tomorrow), today: tomorrow, openEpisode: dismissed });
nextEpisode(dismissed, longer) === dismissed
=> true

nextEpisode(dismissed, { kind: "healthy" })
=> null
```

## The message names the connector and what to look at

```ts continue
describeVerdict("gmail", quiet)
=> gmail has brought in nothing new on its last 3 days of syncing since 2026-09-16 (more than 2 days without something new is unusual for it). Syncs are still succeeding, so check whether a filter, permission or upstream change stopped it.

describeVerdict("gmail", connectorVerdict({ days: history("PEE"), today, openEpisode: null }))
=> gmail has failed every sync on its last 2 days of running, since 2026-09-17: invalid_grant
```
