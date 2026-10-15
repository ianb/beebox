---
kind: case
cue: what the timed jobs produced, the hourly test run, library updates, dead code, disk caches
with: schedules-at-a-glance, run-only-head
source: inventory.md "The schedules, one line each" (Aug 24 – Oct 9)
---
# What four timed jobs produced while I wasn't watching
## Timed jobs, six weeks
| Timed job | Runs / agent sessions | Produced |
|---|---|---|
| run every test, hourly | 871 / 0 | 29 broken merges to main traced, 28 closed |
| check for agent library updates, daily | 46 / 36 | 23 library updates, 15 issues |
| find unused code, weekly | 8 / 7 | 19 commits removing it |
| disk cleanup, daily | 7 / 0 | caches that had reached 31 GB and 62 GB |
