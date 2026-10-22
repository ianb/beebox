---
kind: quote
cue: three escapes, everything was green and the app was broken, the state was wrong, why we walk the real app
with: smoke-runs, selection-gate-missed
source: inventory.md "Smoke tier and weekly smoke review" (1e8cfe8c4, Aug 26); slide 10e
---
# Every check passed while the app was broken
## Why we walk the real app
```text
Three escapes on 2026-08-25/26 passed typecheck, lint and their selected
tests while the app was broken: the code was right and the state was wrong.
```
The commit message that added the walk
