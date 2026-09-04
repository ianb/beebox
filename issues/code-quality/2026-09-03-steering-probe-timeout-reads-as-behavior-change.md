---
title: "The SDK steering probe reports a scenario timeout as a steering-behavior change, with no retry"
workstream: sdk-update
area: beebox
priority: normal
filed-by: agent
discovered-by: agent
discovered-in: worktree-sdk-update — verifying the 0.3.258 bump
---

`beebox/scripts/sdk-steering-probe.ts` is the gate the `sdk-update` monitor runs
after every pin bump. On 2026-09-03 it failed on the first scenario:

    steer (mid-tool push → same-turn injection) ... FAIL — timed out before the steer answer arrived
    Steering behavior changed under this SDK version. Do not ship the bump until
    docs/chat-session-lifecycle.md and the chat steering design are reconciled.

Three consecutive re-runs on the same pin (`0.3.258`) then passed cleanly. The
scenario waits up to `SCENARIO_TIMEOUT_MS` (120s, line 53) for a live model
turn; a slow turn exhausts it, `obs.timedOut` is set, and the script prints the
same "Steering behavior changed … do not ship" verdict it prints for a genuine
regression.

**The two outcomes deserve different words.** A timeout says the probe learned
nothing; a lost message, or an answer arriving in the wrong turn, says the
behavior moved. Line 138 already distinguishes them internally — it picks
between "timed out before the steer answer arrived" and "steer message was LOST
(never answered)" — but the summary collapses both into the strongest possible
claim.

Why it matters here specifically: this gate runs unattended. A false "do not
ship" either blocks a bump that was fine, or — worse over time — teaches
whoever reads these reports that the probe's severe verdict is often noise,
which is exactly the wrong lesson for the one check standing between a bad SDK
release and every box agent.

**Suggested shape**, both parts small:

1. **Retry a timed-out scenario once** before reporting it. Bounded, not
   open-ended: one extra attempt distinguishes a slow turn from a stuck one, and
   two timeouts in a row is real evidence.
2. **Report a timeout as its own outcome** — "INCONCLUSIVE (timed out)" rather
   than FAIL — and let the exit status say "could not verify" rather than
   "behavior changed". The monitor can then treat inconclusive as "re-run before
   deciding" instead of "revert the pin".

Worth checking while in there whether 120s is simply too tight for the first
scenario, which does the most work before its assertion.
