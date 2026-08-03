---
title: "`core/box/file-watcher.doctest.md` flakes intermittently under load"
area: callback-box
filed-by: agent
discovered-in: worktree-top-nav-ia — /finish full-suite verification
---

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
