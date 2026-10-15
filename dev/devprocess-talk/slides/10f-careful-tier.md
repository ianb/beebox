# Demoted, not deleted
## Supporting: beebox/test/careful.txt
```text
# The careful tier: timing-sensitive tests that run alone, one job at a time,
# in the batched full run — not on every `pnpm test:changed`. They are not
# deleted for being a nuisance; they run less often and more carefully.
#
# Membership is a judgment, not an automatic demotion. `test-ledger report`
# prints candidates by flake share; a human moves lines here.
# A path listed here that does not exist fails the run rather than silently
# shrinking the tier.

# 29 failures / 365 runs, 10 derived flakes — the suite's worst file.
test/field-test/run.doctest.md
# 10 / 361, 8 of them unimplicated — fs watch latency, not the code under test.
test/core/box/file-watcher.doctest.md
```
- Six files; all at zero failures in their last 40 runs
- It stopped flakes blocking landings; it did not reduce the flake count. A fix-or-delete pass over 49 files is open

Notes:
Also here: the rule "never rerun a suite to chase green", and a policy drift the October review caught: the doctest skill still told agents to rerun and file flake issues while the finish agent said never to.
