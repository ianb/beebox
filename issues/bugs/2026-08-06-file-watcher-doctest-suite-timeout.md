---
title: "`file-watcher.doctest.md` can time out as a whole under parallel suite load"
workstream: workstreams
area: callback-box
filed-by: agent
discovered-in: worktree-ios-box-switcher-gate — /finish full-suite verification
---

Reopened 2026-08-10 after the same whole-file expiration recurred during the
`workstreams` finish suite: TAP expired the file at 300,999 ms and finished
6,765/6,768. The file then passed 12/12 in isolation in 8.3 seconds. This branch
touches neither the watcher implementation nor this doctest.

The full `pnpm test` suite timed out while running
`test/core/box/file-watcher.doctest.md`. TAP reported this signature:

```text
not ok 470 - timeout!
  expired: test/core/box/file-watcher.doctest.md
# { total: 6289, pass: 6286, fail: 3 }
```

The file passed 12/12 assertions immediately afterward with
`pnpm exec tap -j1 test/core/box/file-watcher.doctest.md`. The branch did not
touch the watcher test or implementation. The one permitted full-suite rerun
then passed 6,291/6,291 assertions.

This differs from the resolved
[watcher assertion-race issue](../closed/bugs/2026-08-03-file-watcher-doctest-flaky-timing.md).
That issue recorded individual timing assertion failures. This occurrence
expired the entire test file under parallel suite load.

## Resolution

Later full-suite runs localized the apparent whole-file expiration to the
notification-budget scale assertion. Reconciliation deliberately stats up to
1,024 discovered files sequentially, but the doctest allowed only five seconds
for that bounded work to reach its limit log. Under six-way suite contention
the scan could exceed that assertion deadline even though it completed and the
same file passed 12/12 in isolation.

The test still polls for the exact limit outcome, but now gives this scale
fixture a 30-second condition deadline. This does not add a sleep or change the
production watcher; successful runs still finish as soon as the limit is
observed.
