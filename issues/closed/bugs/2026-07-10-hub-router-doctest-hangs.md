---
title: "hub router doctest hangs"
workstream: architectural-review
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — verifying `pnpm test` while landing the no-non-null-assertion / no-unnecessary-condition preset burn-down (architectural-review-followups Track 7c/7d)
resolution: implemented
---

**Closed 2026-07-10 — the diagnosis below was wrong; the hang WAS this
round's regression.** The "ambient env var" was set by the doctest itself
(`hub-router.doctest.md:323` set `GOOGLE_OAUTH_CLIENT_ID` with no secret,
the half-config that `registerAuthRoutes` now makes fatal via
`MissingOAuthClientSecretError` — c5dff450's bug fix). The `git stash`
"pre-existing" check was invalid because that fix was already *committed*
beneath the stash. Fixed by pairing the fake secret (and its cleanup) in
`hub-router`, and the same fragile ID-only pattern proactively in
`box-picker` and `mobile-spa-fallback` doctests; all pass in ~1.7s
(previously a 5-minute handle-leak timeout).

`test/hub/hub-router.doctest.md` hung and timed out (~5 minutes, tap's
default handle-leak timeout) on a full `pnpm test` run in this worktree, on
`hub-router.doctest.md:112 — const box = await startFakeBox();`. Confirmed
**pre-existing and unrelated** to the lint-rule change in this session: `git
stash` back to the unmodified tree and re-running the same file reproduces
the same hang.

The same run also logged a `MissingOAuthClientSecretError` from
`registerAuthRoutes` (`src/webapp/routes/auth.ts:79`) partway through —
`GOOGLE_OAUTH_CLIENT_ID` was set in the ambient environment without
`GOOGLE_OAUTH_CLIENT_SECRET`. Unclear yet whether that's the same failure as
the hang (a box startup that throws during plugin registration could plausibly
leave a listening server whose handle tap detects as a leak) or an unrelated,
separately-leaking env var from some other tool/session. Whoever picks this
up should first try reproducing with `env -u GOOGLE_OAUTH_CLIENT_ID` to rule
out the env leak as the actual cause before treating this as a genuine
router/box-startup bug.

## Research (incomplete)

- Does this reproduce on `main`, or only in this worktree?
- Is it the same failure mode as the known
  `test/hub/child-output-log.doctest.md` stream-ordering race
  (`2026-07-09-flaky-child-output-log-doctest.md`), or a distinct hang?
- Where is `GOOGLE_OAUTH_CLIENT_ID` getting set without its secret — a leaked
  shell/session env var, or something the test setup itself sets?
