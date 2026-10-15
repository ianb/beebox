# 5b. The suite is too slow and too often red
## August 25–26
- A thousand doctests; full runs "were mostly red for reasons the branch did not cause"
- Aug 25: run only what the change implicates; a ledger of every run; a machine-wide semaphore; the hourly full suite on main, bisecting red to the landing
- The selection project's own gate failed (25% of branches fully accounted for, bar 50%) and it said so
- Aug 26: a smoke tier, because three escapes in two days passed typecheck, lint and selected tests while the app was broken
- Exposed: the ledger made 49 flaky files visible; the hourly reporter blamed its own commits

Notes:
Supporting: the measured miss, a ledger record and the flake definition, the full-suite yaml and bisect, the self-blame false start, the smoke origin and steps, the careful tier.
