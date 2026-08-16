---
name: field-probe
description: Use when a bug only manifests in an environment the agent can't drive itself — the boxholder's phone (iOS app / mobile Safari), a prod-only condition, real-device gestures or timing — so diagnosis needs instrumentation deployed to the field and the boxholder acting as your hands. Triggers include "it still happens on my phone", "works on desktop but not on device", "can't reproduce it here", "run a field probe", "probe this on device". Not for anything reproducible via bin/browse or a doctest — build the local loop instead (cb-debug).
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Field Probe

A **field probe** is the debugging loop for bugs that live where you can't:
ship flag-gated instrumentation to the real environment, hand the boxholder a
short reproduction script, pull the readings back from the box's logs, analyze,
then iterate or fix — and explicitly decide the instrumentation's fate at the
end. It is the "ask for an artifact from the field" arm of cb-debug's Phase 1:
the trace **is** the red-capable signal when no local loop can reach the bug.

The boxholder is part of the loop, so the protocol optimizes for their time:
one deploy per round when possible, instructions they can follow from a phone
in under a minute, and a headline they cannot miss.

## The handoff headline (the part the boxholder sees)

Whenever a probe is deployed and it's the boxholder's turn to act, the message
MUST lead with this exact style of headline, followed by numbered steps:

> ## 📡 FIELD PROBE — your move
>
> 1. Force-quit the app / reload the tab (fresh bundle).
> 2. Type `/scrolldebug` in the composer (trace on).
> 3. Reproduce the problem for ~20–30s the way it usually bites.
> 4. Type `/scrolldebug` again (flush), then tell me you're done.

Rules for the steps: concrete actions only, on-device wording (what to tap and
type, not what the code does), always start with the fresh-bundle step after a
deploy (a stale WKWebView silently tests the old code), and always end with
"tell me you're done" — the boxholder's reply is what resumes the loop. Keep it
to ≤5 steps; if the probe needs more, split it into rounds.

## The loop

1. **Instrument, gated and bounded.** The probe must be default-off, toggleable
   from the device with no devtools, bounded in memory and log volume, and
   content-free (numbers, enum-ish strings, element counts — never message
   text, card paths, or URLs; the trace transits a log a bug report might
   quote). The house pattern is `src/frontend/src/lib/scroll-diagnostics.ts` +
   its `/scrolldebug` composer command (frontend-only command riding the
   `/fakestream` interception seam in `machines/chat-actors.ts`): ring buffer,
   periodic flush through `console.warn`, which the closed-debug-panel client
   forwards into `client-debug.log`. Reuse that toggle/flush shape — and for
   scroll/layout work reuse that very module — rather than inventing a channel.
   Backend probes log server-side directly; same gating rules.
2. **Verify the pipeline locally before deploying.** Toggle the probe via
   `bin/browse` against the worktree box and confirm events actually land in
   `content/.callback-box/client-debug.log`. A probe that reaches the device
   broken wastes a boxholder round-trip, the most expensive resource here.
3. **Land it.** Deploy is main-only, so the probe merges like any change —
   suite green, normal landing flow. Merging to main deploys; get the
   boxholder's explicit OK as usual. Say when the deploy should be live.
4. **Hand off** with the headline above. Include what to reproduce (their words
   for the symptom, not yours) and roughly how long.
5. **Pull the readings.** For a prod box: the client debug log lives at
   `/home/callback/boxes/<slug>/content/.callback-box/client-debug.log` on the
   server (`deploy/server-ip` in the MAIN checkout; worktrees don't have it),
   or via the box's debug-log route with `deploy/prod-curl`. Local/worktree
   boxes: read the file directly. Grep the probe's tag (e.g. `[scroll-trace]`).
6. **Analyze against a question, not vibes.** Before reading, write down what
   each hypothesis predicts the trace shows; then read the trace to falsify.
   If the trace can't distinguish the hypotheses, that's a probe defect —
   sharpen the probe (add the missing field) and go one more round, don't
   squint harder.
7. **Iterate or fix.** More rounds are normal: fix-candidate + probe still in
   place is the best round shape, because the same trace then verifies the fix
   on the device ("run the probe again — I'll check the trace shows no writes
   during your fling").
8. **Decide the probe's fate — explicitly, in the wrap-up.** Either **keep** it
   (it stays default-off, content-free, and cheap when off, and the surface is
   a repeat offender — document the command in the relevant testing/debugging
   doc so it's discoverable) or **remove** it (one-off scaffolding; delete like
   any `[DEBUG-...]` probe). Never leave an undocumented keeper: an
   instrumentation command nobody can find is dead weight in the bundle.

## Honesty rules

- A green desktop scenario plus a deployed probe is still an **unverified**
  fix until the boxholder's trace (or their report) confirms it on device —
  say so plainly in every wrap-up.
- If the trace comes back clean while the boxholder still feels the bug, the
  probe is measuring the wrong thing (wrong element, wrong layer — e.g. the
  page scrolls, not the list) — treat that as a finding about where the bug
  is NOT, and re-aim.
- Count rounds. Like cb-debug's circuit-breaker: three probe rounds that
  produce no discriminating evidence mean the approach (or the architecture)
  is wrong — stop and rethink with the boxholder.
