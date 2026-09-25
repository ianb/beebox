---
title: "The strict-fetch and fetch-stub machinery in `cli/lib/fetch.ts` has no caller left"
workstream: knip-sweep
area: beebox
priority: backlog
filed-by: agent
discovered-by: agent
discovered-in: knip-sweep run 20260923-075405
labels: [dead-code]
---

`bbx scenario` and its runner were deleted in 741dca4cb. That commit left the
fetch-stub code in `beebox/src/cli/lib/fetch.ts` for its own issue. This is
that issue.

The knip sweep deleted the three exports whose only caller was the runner:
`loadFetchStubs`, `clearFetchStubs`, and `uninstallStrictFetch`. The rest of
the code is still reachable, but only through environment variables that
nothing in the repo sets:

- `beebox/src/cli/bootstrap.ts` calls `installStrictFetch()` when
  `BBX_STRICT_FETCH` is set.
- `ensureEnvStubs()` reads `BBX_STUBS_FILE`. The `after` gate on each stub
  reads `BBX_SCENARIO_START_TIME`.
- All three variables are passed through by `beebox/src/hub/child-env.ts` and
  `beebox/src/core/script-env-allowlist.ts`, and `beebox/src/lib/env.ts`
  mentions `BBX_STRICT_FETCH` in a comment.

No test, script, or doc sets any of these variables. `src/field-test/`
replaced the scenario runner and does not use them.

To remove it: delete `cli/lib/fetch.ts`, the bootstrap hook, and the three
allowlist entries. First, confirm that no box's scheduled scripts or
field-test setup sets these variables outside the repo. The sweep did not do
this removal because it deletes a test harness entry point, not a single
dead export.
