---
kind: timeline
cue: it blamed itself, thirteen issues overnight, the machine was overloaded, which commit broke it
with: full-suite-red-fates
source: inventory.md "Hourly full suite with bisection"; slides 10c, 10d
---
# My hourly test job kept blaming the wrong commit
## Finding the commit that broke it
2026-08-25 — every test runs hourly; failures traced to a commit
2026-08-26 — one failure files thirteen issues, blaming its own reports
2026-09-11 — skip runs when memory is short; load faked failures
2026-10-06 — the blamed commit must touch code the test uses
