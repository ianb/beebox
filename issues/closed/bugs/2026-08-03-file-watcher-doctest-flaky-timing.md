---
title: "`core/box/file-watcher.doctest.md` flakes intermittently under load"
workstream: top-nav-ia
area: callback-box
filed-by: agent
discovered-in: worktree-top-nav-ia — /finish full-suite verification
resolution: implemented
---

Resolved in `eded7086` by making the doctest prove that each macOS directory watcher has
delivered an event before making timing-sensitive mutations. `fs.watch()` has
no readiness event on macOS, so `watcher.ready` could complete before FSEvents
was actually delivering. The updated test also throws when a polling deadline
expires instead of silently proceeding.

Verification: the focused file passed 30 consecutive runs (the original failed
by run 2), and the full callback-box suite passed 6,136/6,136 assertions.

The reported `grew < 20` failure was misleading: the failing TAP subtest was a
later event-delivery assertion, while the diagnostic `source` field pointed to
the preceding doctest block. That separate reporting problem is tracked in
`issues/bugs/2026-08-05-doctest-failure-source-points-to-previous-block.md`.

`test/core/box/file-watcher.doctest.md` (added in `9b2aa44d` / `054cc4f4`, the
chokidar→directory-watch FD-exhaustion fix) fails intermittently, both inside
the full `pnpm test` run and in isolation (`pnpm exec tap
test/core/box/file-watcher.doctest.md`). Across four isolated runs taken back
to back: pass 9/9, fail 1/9, pass 9/9, fail 3/9 — a different subtest (or
different combination of subtests) failed each time, e.g.:

```
file-watcher.doctest.md:91  — "grew < 20" expected true, got false
file-watcher.doctest.md:108 — expected true, got false
file-watcher.doctest.md:176 — watched-dir set ". procedure store store/real"
                                vs actual ". procedure store" (missing store/real)
```

These are all timing assertions on `fs.watch(root, { recursive: true })`
settling (FD-count deltas and watched-directory-set membership) — consistent
with the test not waiting long enough for the recursive watcher to register
new subdirectories/files before asserting, more likely to lose the race when
the machine is under load (e.g. during a full-suite run with many concurrent
doctests). Not reproducible as a single deterministic failure — it is a race,
not a fixture bug.

Worth either raising the settle-wait before the affected assertions or making
them poll-until-true instead of a single point-in-time check.
