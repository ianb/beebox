# CSP violation digest

The digest turns the JSONL `csp-reports.log` (written by the `/api/csp-report` sink) into a deduped summary the local review routine uses to decide whether the policy is safe to harden. It arranges context — it never flips the policy itself. `digestCspReports` digests a whole log; `parseCspLog` + `entriesSince` + `digestEntries` are the incremental pieces the cursor-driven CLI composes.

```ts setup
import { digestCspReports, parseCspLog, entriesSince, newestTs, digestEntries } from "../../src/dev/csp-digest.js";

// One JSONL line, matching the sink's `{ ts, directive, blocked, doc }` shape.
function line(ts, directive, blocked) {
  return JSON.stringify({ ts, directive, blocked, doc: "https://app/x" });
}
```

## A clean log proposes hardening

No violations → safe to flip Report-Only to enforcing (with a human in the loop):

```ts
const clean = digestCspReports("");
clean.clean
=> true

clean.total
=> 0

clean.summary.includes("Safe to harden")
=> true
```

## Violations are deduped and counted

Repeated violations of the same directive+origin collapse into one row with a count and a first/last-seen window; distinct ones are listed separately, most-frequent first. Blank lines and any non-JSON line are skipped:

```ts
const log = [
  line("2026-06-01T10:00:00.000Z", "frame-src", "https://vimeo.com"),
  line("2026-06-01T11:00:00.000Z", "frame-src", "https://vimeo.com"),
  line("2026-06-02T09:00:00.000Z", "img-src", "https://cdn.test/x.png"),
  "garbage line that should be ignored",
  "",
].join("\n");
const d = digestCspReports(log);
d.total
=> 3

d.clean
=> false

d.violations.length
=> 2
```

```ts continue
const top = d.violations[0];
`${top.directive} ${top.blocked} ${top.count} ${top.firstSeen} ${top.lastSeen}`
=> frame-src https://vimeo.com 2 2026-06-01T10:00:00.000Z 2026-06-01T11:00:00.000Z

d.summary.includes("Do NOT harden")
=> true
```

## Incremental mode reports only what's new since the cursor

`entriesSince` filters by the prior run's timestamp watermark (ISO-8601 UTC sorts lexically, so `>` is chronological); `newestTs` is what the CLI writes back as the next cursor. This is robust to the sink's rolling truncation — it filters by time, not byte offset.

```ts
const incLog = [
  line("2026-06-01T10:00:00.000Z", "frame-src", "https://vimeo.com"),
  line("2026-06-01T11:00:00.000Z", "frame-src", "https://vimeo.com"),
  line("2026-06-02T09:00:00.000Z", "img-src", "https://cdn.test/x.png"),
].join("\n");
const entries = parseCspLog(incLog);
const since = "2026-06-01T12:00:00.000Z"; // after both vimeo hits, before the img-src one
const fresh = entriesSince(entries, since);
fresh.length
=> 1

fresh[0].directive
=> img-src

newestTs(entries)
=> 2026-06-02T09:00:00.000Z
```

The summary for a delta lists the new violations and defers the harden verdict to `--all` (a whole-log judgment), rather than asserting "safe to harden" off a clean delta:

```ts continue
const delta = digestEntries(fresh, { incremental: true, since });
delta.summary.includes("1 new CSP violation(s) since 2026-06-01T12:00:00.000Z")
=> true

delta.summary.includes("--all")
=> true
```

When nothing is new since the cursor, the delta is clean — but it says so as "no *new* violations", not "safe to harden":

```ts continue
const none = digestEntries(entriesSince(entries, newestTs(entries)), { incremental: true, since: newestTs(entries) });
none.clean
=> true

none.summary.includes("No new CSP violations since")
=> true

none.summary.includes("Safe to harden")
=> false
```
