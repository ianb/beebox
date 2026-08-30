---
title: "agent-browser `mouse wheel` dispatch is flaky: os error 35 after retries, multi-minute hangs"
workstream: integration-tests
area: beebox
filed-by: agent
discovered-in: worktree-integration-tests — live re-test of the card-views-cannot-scroll finding
labels: [field-test-findings, harness]
---

During live UI verification through `bin/browse`, `mouse wheel <dy>` worked
once, then failed repeatedly with `Failed to read: Resource temporarily
unavailable (os error 35) (after 5 retries - daemon may be busy or
unresponsive)`, with individual invocations hanging ~2 minutes before the
error. `press PageDown` also never produced native scrolling on a focused
scroll container (CDP raw-key dispatch does not trigger default scroll
actions), so an operator that needs to scroll inner panes has only a flaky
wheel and `scrollintoview`.

This matters for field tests: scrolling is how an operator reads any card
longer than the viewport, and the first onboarding run's
[card-views-cannot-scroll](../closed/bugs/2026-08-08-card-views-cannot-scroll.md)
finding was largely this tool gap. The operator prompt now teaches
mouse-move-plus-wheel and scrollintoview, but the wheel path needs to be
reliable to trust "content below the fold" observations.

Next steps: reproduce the os-error-35 hang outside our wrapper (bare
`agent-browser mouse wheel`) to decide whether it's the daemon or our
session handling; check for an agent-browser upstream issue/fix; consider
teaching the operator `scrollintoview` as the primary scroll gesture since
element-targeted commands don't hit the flaky path.
