---
kind: case
cue: the hourly test run, failing on main, find the commit that broke it, eleven real breakages
with: reporter-blamed-itself, selection-gate-missed, smoke-runs
source: inventory.md "Hourly full suite with bisection" (871 runs; 29 full-suite-red issues)
---
# Running every test hourly: 29 alarms, 11 real breakages
## 871 hourly test runs
| Outcome | Issues |
|---|---|
| fixed: a real breakage | 11 |
| replaced, mostly from the job blaming its own report | 16 |
| won't fix | 1 |
| open | 1 |
