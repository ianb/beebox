---
kind: contrast
cue: the machine ran out of memory, eighteen gigs of swap, two slots, the limit moved to the machine, nine sessions at once
with: to-do-database, schedules-at-a-glance
source: inventory.md "Machine-wide test semaphore and host-pressure gate", "Router retry"; reports/sweep-parallel-work.md
---
# With nine agents at once, memory runs out before anything else
## Parallel agents, one Mac
Before: about nine agent sessions at once, and 20 GB of swap (disk used as overflow memory)
After: full test and check runs share two slots, and wait while the machine is swapping
