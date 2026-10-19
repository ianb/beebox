---
title: "iOS test testThePersonsRetryOfAWaitingRowFollowsUp fails under the full suite"
workstream: flaky-tests
area: ios-app
labels: [ios, tests]
priority: normal
filed-by: agent
discovered-in: worktree-app-shell — first full iOS suite run through bin/apple-test --ios
resolution: implemented
---

Fixed by the commit that carries this issue's `Issue:` trailer. Both waits in `BoxScreenStoreTests` now also wait for `outbox.inFlight` to empty, which happens only after the attempt's save. The retry test failed after 144 of 200 iterations before the fix and passed 500/500 after. Its neighbour `testAnAnswerAfterLeaving…` had the same flake and passed 1200/1200 for the class. Full `bin/apple-test --ios` passed three times.

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

## 2026-10-18: cause confirmed, test fixed

Reproduced with `-only-testing:…/testThePersonsRetryOfAWaitingRowFollowsUp
-test-iterations 200 -run-tests-until-failure` on a loaded host (load1 96 to
720). The test passed 144 times, then failed at `:401` with
`XCTAssertEqual failed: ("nil") is not equal to
("Optional(BeeBox.BoxScreenFollowUp.openChat(sessionID: "s1"))")`.

The cause is the race this issue suspected. `BoxScreenStore.submitEntry`
publishes the "Waiting to send" reveal before it rethrows. After that,
`QuickChatOutbox.attempt` records the failure, awaits `persist()` on the
repository actor, and only then removes the id from `inFlight`. A retry inside
that window hits the `inFlight` guard and does nothing, so no follow-up
arrives. Under load, the test's poll can fall inside that window.

This is not a race in the product. While the id is in `inFlight`, the row's
status is `.sending`, and `BoxScreenView.outboxRow` shows "Sending" with no
Retry button.

Fix (test only): wait for `store.followUp != nil && store.outbox.inFlight.isEmpty`,
which is the same wait the neighbouring launch-retry test uses. After the fix,
500 of 500 iterations passed (load1 266 to 576).

A class run (`BoxScreenStoreTests`, 30 iterations) found a second flake of the
same kind in `testAnAnswerAfterLeavingSwitchingBoxesOrBackgroundingOnlyUpdatesTheRows`.
It failed at `:446` with `["A thought", "A thought"]` is not `["A thought"]`
(switched boxes). The three loop iterations share one `rootURL`. Each iteration
waits for the in-memory `outbox.entries.isEmpty`, but the `persist([])` write
is still pending. The next iteration's `start()` then reloads the previous
entry from disk and sends it again. Fix (test only): wait for `entries.isEmpty && inFlight.isEmpty`. `attempt`
clears `inFlight` only after the save, so this wait guarantees the file is
written before the next iteration starts.

Evidence after both fixes:

- The whole class at 60 iterations ran 1200 test cases with no failure
  (load1 46 to 88).
- That test alone passed 300 of 300 iterations (load1 81 to 115).
- One full `bin/apple-test --ios` run passed; load1 was 33.6 at start.
