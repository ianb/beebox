---
kind: rule
cue: slow lane, tests that fail at random, quarantine, demoted not deleted, a judgment call
with: flake-single-rerun, ledger-flake-load
source: beebox/test/careful.txt header; inventory.md "Careful tier and flake quarantine" (6 files)
---
# I demote tests that fail at random. Nobody deletes them.
## Unreliable tests
```text
They are not deleted for being a nuisance; they run less often and more
carefully.

Membership is a judgment, not an automatic demotion.
```
