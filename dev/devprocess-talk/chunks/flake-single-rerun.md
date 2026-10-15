---
kind: rule
cue: a test that fails at random, rerun it, never rerun to chase green, rerun once alone, named not hidden
with: ledger-flake-load, careful-tier-demoted
source: bin/finish-verify.ts header; inventory.md "Flake policy" (803ff20fa, Aug 25)
---
# A random failure gets one rerun, then it gets named
## Unreliable tests
```text
A failing test file is re-run once in isolation: passing there is a flake …
and is named, not hidden; failing again is real and blocks.
```
