---
title: "iOS test testThePersonsRetryOfAWaitingRowFollowsUp fails under the full suite"
workstream: unattached
area: ios-app
labels: [ios, tests]
priority: normal
filed-by: agent
discovered-in: worktree-app-shell — first full iOS suite run through bin/apple-test --ios
---

`BoxScreenStoreTests.testThePersonsRetryOfAWaitingRowFollowsUp`
(`ios-app/BeeBoxTests/BoxScreenStoreTests.swift:385`) failed once in a full
`bin/apple-test --ios` run on 2026-10-17 (iPhone 17 Pro simulator, 0.88 s).
The same suite passed three times in a row when run alone with
`-only-testing:BeeBoxTests/BoxScreenStoreTests`. The pairing change in that
branch does not touch the box screen store.

Likely cause, not verified: the test waits only for `store.followUp != nil`
after the offline submit (`:392`), then retries the outbox entry (`:399`). It
does not wait for the first submit to leave `outbox.inFlight`, which the
neighbouring `testALaunchRetryOnlyUpdatesTheRows` does (`:410`,
`client.submitted.count == 1 && store.outbox.inFlight.isEmpty`). Under load the
retry can find the entry still in flight.

The run captured no assertion text: `bin/apple-test` prints xcodebuild's
`-quiet` output, which names the failed case without its message. Rerun with
the result bundle (`-resultBundlePath`) to get it.
