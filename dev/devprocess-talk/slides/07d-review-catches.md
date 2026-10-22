# What the other model found
## Supporting: three commit bodies
- 134 commits pair a detection verb with a cross-model review; 55 issues name a review as their source; 140 Claude sessions used it in 60 days

```text
fix(test-economics): eight defects from the Codex review of the branch
- test-ledger: a signal now reaches the tap child and waits for it… the slot
  used to go back while tap was still running.
- full-suite: 'last tested commit' comes from one completion marker written
  after BOTH tiers finish… a run that died between them marked the commit
  tested with the careful tier unrun.                           (ea2358b2a)

fix(tests): close the two false greens a cross-model review found in the smoke tier
The deploy half asserted the wrong thing. It probed a deep box route and
accepted "not 404" as proof the SPA fallback was registered — but the hub
redirects an unauthenticated navigation to login before the child is ever
reached… It could not fail for the right reason.              (92c74000e)

Sweep's live-agent guard fails OPEN when ps/lsof can't answer — found by
cross-model (codex) review of the codex teardown work.      (issue, 2026-08-04)
```

Notes:
The review also reviewed most of the other gates in this talk: the smoke tier, the lint economics, the liveness guard, the test-selection plan (which it flipped twice).
