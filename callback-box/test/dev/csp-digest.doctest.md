# CSP violation digest

`digestCspReports` turns a raw `csp-reports.log` into a deduped summary the scheduled review routine uses to decide whether the policy is safe to harden. It arranges context — it never flips the policy itself.

```ts setup
import { digestCspReports } from "../../src/dev/csp-digest.js";
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

Repeated violations of the same directive+origin collapse into one row with a count and a first/last-seen window; distinct ones are listed separately, most-frequent first:

```ts
const log = [
  "2026-06-01T10:00:00Z [csp] directive=frame-src blocked=https://vimeo.com doc=https://app/a",
  "2026-06-01T11:00:00Z [csp] directive=frame-src blocked=https://vimeo.com doc=https://app/b",
  "2026-06-02T09:00:00Z [csp] directive=img-src blocked=https://cdn.test/x.png doc=https://app/c",
  "garbage line that should be ignored",
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
=> frame-src https://vimeo.com 2 2026-06-01T10:00:00Z 2026-06-01T11:00:00Z

d.summary.includes("Do NOT harden")
=> true
```
