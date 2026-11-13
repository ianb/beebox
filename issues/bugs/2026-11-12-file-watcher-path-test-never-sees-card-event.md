---
title: "The file-watcher test that rewrites a card until its event arrives never sees the event on this Mac"
workstream: unattached
area: beebox
labels: [tests, file-watcher]
filed-by: agent
discovered-by: agent
discovered-in: "worktree-chat-presence — change-selected tests for chat calls, 2026-11-12"
---

`beebox/test/core/box/file-watcher.test.ts`, subtest "Consumers key on path
alone, so that is what has to be right.", fails with "the card file-change
event was not true after 60000ms; last value: false". The test rewrites
`store/Note.doc.card` every 20 ms for 60 seconds and no `file-change` event
for that path arrives.

It fails the same way on `main` at `0157eed49` and on
`worktree-chat-presence`, both when the file runs alone
(`pnpm exec tap test/core/box/file-watcher.test.ts`, 19 of 20 pass) and
inside `pnpm test:changed`, where the whole file then takes about 300 s. The
other watcher subtests in the file pass in the same runs, including "The
direct statement of the bug."

Earlier watcher flakes were load-related
(`../closed/bugs/2026-08-08-file-watcher-rapid-write-event-count-flake.md`,
`../closed/bugs/2026-08-06-file-watcher-doctest-suite-timeout.md`). This one
reproduces on a lone run, so load alone does not explain it. Not checked:
whether FSEvents delivers for the temp directory at all on this machine (a
macOS update or a privacy setting could stop it), and whether the test passes
on Linux.
