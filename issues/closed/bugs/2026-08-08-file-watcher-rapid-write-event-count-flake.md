---
title: "`file-watcher.doctest.md` rapid-write event count flakes under parallel load"
workstream: member-password-reset
area: callback-box
filed-by: agent
discovered-in: worktree-member-password-reset — finish verification after merging current main
resolution: implemented
---

The full `pnpm test` suite intermittently fails the rapid-write assertion in
`callback-box/test/core/box/file-watcher.doctest.md`. The test writes four
versions about 12 ms apart and expects at least two `file-change` events after
the 50 ms debounce window. Under parallel suite load, it observed only one:

```text
file-watcher.doctest.md:319
expected: events>=2: true | bounded: true
actual:   events>=2: false | bounded: true
```

The suite reported 6,444 passes and one failure out of 6,445 assertions. The
same file immediately passed all 12 assertions in isolation with:

```sh
pnpm exec tap test/core/box/file-watcher.doctest.md -j1
```

The branch did not change the watcher implementation or its doctest. This
signature differs from the open
[whole-file timeout](../../bugs/2026-08-06-file-watcher-doctest-suite-timeout.md). The
older [watcher assertion-race issue](2026-08-03-file-watcher-doctest-flaky-timing.md)
was closed after adding an event-delivery readiness handshake, but this later
rapid-write assertion can still undercount events under contention.

Determine whether the contract should require two events from this write
pattern on macOS. If it should, make the test wait on a deterministic delivery
condition. If it should not, replace the event-count assertion with a check of
the actual trailing-event behavior the test intends to guarantee.

## Resolution

The event count was not a valid macOS contract. FSEvents may combine several
writes into one notification before Node observes them, particularly under
parallel load. The doctest now models the behavior that matters: a consumer
first observes one version, later writes land inside the watcher's throttle
window, and a trailing hint eventually lets the consumer observe the final
version. It polls for that outcome instead of sleeping for a presumed delivery
interval.

The revised test was proved red-capable by temporarily removing the watcher's
pending-edge assignment; it timed out with stale content. With the production
logic restored, the focused test passed 60 contention-shaped repetitions and
the complete watcher doctest passed all 12 sections.
