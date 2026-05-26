---
name: When fixing one bug in a function, scan the rest of it
description: Compound bugs are common — after fixing one line, re-read the rest of the function with the same scrutiny before declaring done.
type: feedback
originSessionId: 1565ea82-956b-4aee-9d19-c96dc658beb4
---
When you fix one bug inside a function, don't assume the rest of the function is fine. Re-read the entire function — especially anything that feeds into the same library call, output format, or external API — with the same scrutiny you used to find the first bug. Bugs cluster, and you've already loaded the mental model for the area.

**Why:** In a session fixing the google-calendar connector, I fixed a format mismatch in `ICAL.Time.fromDateTimeString()` calls (basic vs extended ISO 8601), ran a smoke test, and got "0 errors" on a 24-event sync. I almost moved on — and only noticed by visual luck that the generated `.ics` file had `TZOFFSETFROM:+020` (4 chars) instead of the correct `+0200` (5 chars). That was a *second*, separate bug in the same function (`formatOffset` was emitting `+HHMM` but ical.js's `utc-offset.toICAL` expects `+HH:MM` and strips the colon to produce the wire format). Both bugs were the same category — "we're passing strings in a format ical.js doesn't expect" — just in different lines. The user noticed I "really struggled to finish that"; the struggle came from finding the second bug reactively instead of proactively.

**How to apply:** After fixing a bug inside function X that interfaces with library Y, before committing:
1. Re-read function X top-to-bottom once more, asking "does anything else here interact with Y in a similar way?"
2. If there's any generated output (JSON, .ics, HTML, SQL), eyeball a sample for anomalies — not just "did it error", but "does the output look structurally right."
3. "0 errors" from a smoke test is necessary but not sufficient. An incremental-sync API returning "no new items" might mean "nothing was exercised," not "everything worked."
