---
title: "chat-queue-real.doctest.md hard-fails the whole weekly suite when the runner's Claude Code login lapses"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: weekly manual-test triage — 2026-09-08T195833Z run, commit be7f0683d
labels: [manual-tests]
resolution: implemented
---

> **Closed 2026-09-08 — the diagnosis below was wrong, and the cause is fixed
> (`1b13cc5ed`).** The runner's Claude login had not lapsed: `claude auth
> status` on the machine said logged in. The test harness swaps `$HOME` for a
> throwaway directory (`test/helpers/isolate-user-home.ts`), and Claude Code
> reports logged-out under any other HOME, even with `~/.claude` linked in —
> so the real-SDK doctest could never see the login. The manual tier now
> keeps the real HOME (`BBX_TEST_REAL_HOME=1` in `test:manual`); every other
> isolation stays. Both failed manual tests pass for real after the fix; the
> other failure (`field-test-inject-email`) was the doctest still reading the
> pre-migration `config/box.json` path.

The weekly `test:manual` run failed with exit 1. Two of three doctests failed;
this issue covers `test/manual/chat-queue-real.doctest.md`, the one exercising
a REAL `claude` SDK backend (not the fake one):

```
[ChatSession:send] Sending message (160 chars, 0 image(s), 1 block(s))
not ok 1 - Claude Code is not logged in — run `claude auth login` on this machine
  stack: |
    checkClaudeAuth (src/core/agent/auth-preflight.ts:162:9)
    preflightChatBackend (src/core/agent/auth-preflight.ts:199:5)
    ChatSession.startRun (src/core/chat/session/index.ts:182:11)
    ChatSession.send (src/core/chat/session/index.ts:343:7)
  type: ClaudeAuthError
```

Run: commit `be7f0683d` on `main`, log
`~/src/schedule-runs/manual-tests/runs/20260908-195833.log`.

`checkClaudeAuth` throws `ClaudeAuthError` only on a genuine negative answer —
the empty/inconclusive-probe case was already split out and made
non-fatal in
[auth-preflight-empty-probe-fails-closed](2026-08-24-auth-preflight-empty-probe-fails-closed.md).
So this reads as the scheduled-run machine's own `claude` CLI session having
actually lapsed, not a probe flake — an environmental precondition for this
one doctest, not a code regression. No other test in the suite uses the real
SDK backend, so nothing else in this run was affected by it.

The open tension: `chat-queue-real.doctest.md` is explicitly the doctest that
proves real-SDK behavior (see its neighbor
[transcript-flush-wait-full-timeout-real-sdk](../../bugs/2026-08-09-transcript-flush-wait-full-timeout-real-sdk.md),
which tracks a warning from this same test), and it can only ever run when
this machine happens to be logged in at the moment the weekly schedule fires.
Right now a lapsed login turns into a full suite failure (exit 1, every other
result in the run treated as suspect) rather than a clearly-labeled
environmental skip. Whether the fix is operational (keep this machine's
`claude` login refreshed ahead of the weekly run) or in the harness (skip this
doctest with a visible reason when `claude auth status` reports logged out,
rather than let it fail the whole `tap` run the same way a real code defect
would) is not yet decided.
