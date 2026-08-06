---
title: "`file-watcher.doctest.md` can time out as a whole under parallel suite load"
area: callback-box
filed-by: agent
discovered-in: worktree-ios-box-switcher-gate — /finish full-suite verification
---

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
