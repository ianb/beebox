---
title: "scan-vision integration doctest errors instead of skipping when Claude Code is not logged in"
workstream: test-suite-health
area: beebox
priority: normal
labels: [tests, environments]
filed-by: agent
discovered-in: full beebox suite runs, worktree-glm-v2-layout 2026-09-15 (also in ledger on HEAD 2026-09-11)
resolution: superseded
---

**Closed 2026-10-06 (test-suite-health): the trigger is gone.** The diagnosis below depended on this machine's Claude Code using a Z.ai token with `ANTHROPIC_BASE_URL` set. Today `claude auth status` reports `authMethod: claude.ai`, `apiProvider: firstParty`, and the variable is unset. Under suite isolation the doctest now skips loudly (`[skipped] … Claude Code is not logged in`, 5/5). With `BBX_TEST_REAL_HOME=1` it makes the real call and passes 5/5. The ledger's last failure was 2026-09-15. If an auth-provider override returns, the fix candidates below still apply.

**Diagnosed 2026-09-15.** Confirmed by direct probes; the machine's GLM/Z.ai
auth is the trigger, and the suite's isolation is the mechanism:

- This machine's Claude Code now authenticates with a Z.ai bearer token held
  in a HOME-independent store (it survives a swapped `$HOME`), with
  `ANTHROPIC_BASE_URL=api.z.ai` in the ambient shell env. That combination
  works: the doctest PASSES under `BBX_TEST_REAL_HOME=1`, real call included.
- The suite runs under a throwaway HOME, and the SDK child's env comes from
  the fail-closed `pickBoxSubprocessEnv` allowlist, which carries neither
  `ANTHROPIC_BASE_URL` nor any auth source. The child therefore presents the
  Z.ai token to Anthropic first-party and gets `401 Invalid bearer token`,
  which the Agent SDK surfaces as "Not logged in · Please run /login".
  Reproduced outside tap with `env -u ANTHROPIC_BASE_URL HOME=<tmp> claude -p`.
- The skip gate misses it: the doctest probes with `claude auth status`,
  which reports `loggedIn: true` from credential EXISTENCE alone (keychain),
  without validating the token against the endpoint the child will actually
  use. So the gate passes and the real call fails. Before the GLM migration
  the persistent token was first-party OAuth, so the same isolated run
  authenticated fine — failures start 2026-09-11 in the ledger.

Fix candidates (not implemented):

- Move the doctest to the manual tier (`test/manual/` + the
  `test:manual` list, which already runs with `BBX_TEST_REAL_HOME=1`
  for exactly this reason — see the helper's header). Honest: the test's
  value is a real end-to-end call, which suite isolation can no longer
  provide on an auth-provider-override machine. Cost: it stops running in
  ordinary tiers entirely.
- Or keep the tier and treat an auth-flavored `ClaudeScanSubprocessError`
  ("Not logged in", 401) as a loud skip per this file's stated contract.
  Risk: a genuine beebox auth-regression (env convention drift — this
  test's whole point) would now skip instead of failing.


`test/services/scan-vision-claude-integration.doctest.md` (moved to `beebox/test/services/scan-vision-claude.integration.doctest.md`) shells out to a real
Claude Code subprocess. When the invoking environment has no Claude login, the
call rejects with `ClaudeScanSubprocessError: Not logged in · Please run
/login` and the doctest reports a failure rather than a skip. The skip-reason
plumbing exists (the block guards on `skipReason`), but whatever decides
"credentials available" does not catch this state.

Seen twice on this machine (2026-09-11 and 2026-09-15 ledger records, both
unimplicated by the running changes). Environmental, not a product bug — the
suite goes red for anyone running the full beebox suite without a logged-in
Claude in the test context.

Fix shape: detect the not-logged-in error in the skip decision and emit a TAP
skip with that reason, so the integration tier still runs when credentials
exist and degrades to a visible skip when they don't.
