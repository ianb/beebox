---
title: "A worktree's Vite dev server serves stale modules because macOS FSEvents delivery lags (not a parse error)"
workstream: admin-structure
area: router
labels: [dev-router, vite]
filed-by: agent
discovered-by: agent
discovered-in: worktree-admin-structure — two agents editing components/admin/ while the page was open
resolution: implemented
---

During a session with two agents editing `beebox/src/frontend/src/components/admin/`,
the worktree's Vite server logged a parse error for a half-written file
(`Expected corresponding JSX closing tag`), then one more HMR update 37
seconds later, then nothing. Every later save was ignored: the plain module
URL kept returning the old transform while the same URL with a fresh
`?t=` query returned the new code, so the files were readable and only the
watcher had gone quiet. Touching files and waiting two minutes did not help.
`bin/workstreams down <name>` followed by any request brought it back.

It recurred within minutes of a fresh restart, with no parse error in
between: one edit to `src/lib/admin-card-state.ts` was never picked up while
the plain URL served the old transform and a `?t=` URL served the new one.

What is not known: whether the first parse error caused it, or whether the
watcher hit a limit (macOS FSEvents, or the same 1,024-directory ceiling as
the box watcher issue) around the same time. The log in
`~/.cache/beebox/logs/<worktree>.log` had no watcher error either way, so
an agent has no signal beyond "my change is not showing", which it tends to
read as its own bug.

Two possible fixes: make the router notice a worktree whose Vite has stopped
emitting updates for files that changed on disk and restart it, or at least
log a watcher failure so the dashboard can show it.

Related: [box watcher ceiling](../../bugs/2026-09-07-box-watcher-ceiling-leaves-attach-scopes-unwatched.md).

## Research (2026-09-25)

The parse error was not the cause. The cause is late FSEvents delivery from
the machine-wide `fseventsd` daemon. The Vite watcher did not die and did not
report an error.

- The router runs Vite 8.0.16 (hoisted), not the Vite 5.4 that the frontend
  declares. See [the Vite version issue](../../bugs/2026-09-25-dev-router-runs-hoisted-vite-8-not-the-frontends-vite-5.md).
  Vite 8 bundles chokidar 3.6, which uses the `fsevents` module on macOS.
- Vite keeps each module's transform in its module graph. It invalidates the
  transform only on a watcher `change` event
  (`node_modules/vite/dist/node/chunks/node.js`, `onFileChange`). A `?t=` URL
  is a new module id, so it always shows the current file. This explains the
  "plain URL stale, `?t=` URL fresh" symptom.
- Reproduced on a Vite that had just started: after an append, the plain URL
  stayed stale for more than 20 s, then updated. A second Vite started at the
  same time from the same config got each event at the same moment (within
  50 ms). Both waited 2.5-15 s, and some waits were longer than 15 s. A
  restart does not fix the lag. It only empties the module cache, and the
  next edit lags again. This matches "recurred minutes later".
- Raw FSEvents latency in a new process, with the `fsevents` module and with
  Node `fs.watch` on a directory, was 0.9-14 s (median about 5 s). Normal
  latency is below 0.5 s. `fs.watch` on a single file (kqueue) took about
  1 ms.
- `fseventsd` used 150-200% CPU without stop, had 3.2 GB RSS, and had run for
  21 days. The data volume had 5 GiB free of 926 GiB. There were only about
  73 FSEvents streams on the machine, and the event volume was low (about 225
  events in 20 s). So the cause is not a ceiling on streams or file
  descriptors. `kern.maxfiles` is 122880 and 6913 were in use. Without root,
  the reason for the `fseventsd` load cannot be seen.
- chokidar drops FSEvents batches that have `MustScanSubDirs` set
  (`if (flags & FSEVENT_FLAG_MUST_SCAN_SUBDIRS) return;`). When `fseventsd`
  drops a client's events, those changes are lost with no error. The system
  log showed `USER DROPPED` only at 08:14 today, so this did not cause the
  incidents above.
- The xcodebuild line `DVTFilePathFSEvents: Failed to start fs event stream`
  is not evidence of a machine-wide failure. It comes from the git/xcrun shim
  that runs inside the Codex sandbox, which blocks FSEvents. It is in the
  output of each cross-model review since August.

## Fix (commit 121c9c6f5)

On macOS, `beebox/src/frontend/vite.config.ts` sets
`server.watch = { usePolling: true, interval: 1000, binaryInterval: 1000 }`.
With polling, chokidar calls `stat()` on each watched file and does not use
`fseventsd`.

- Measured after the change, with `fseventsd` still lagging 1-14 s: 14
  atomic and in-place edits reached the plain URL in 0.06-1.04 s, and each
  one logged `hmr update`.
- Idle CPU per running Vite: FSEvents about 0.8% of one core, polling at 1 s
  about 1.6%, at 500 ms about 2.3%, at 100 ms (chokidar's default) about 8%.
  A polling Vite holds about 22 file descriptors.
- Not covered: other FSEvents watchers on the machine still lag. These include
  editors, `tsx watch`, and box watchers. The fix does not add a log signal,
  because the watcher does not fail. It is only late. A lagging `fseventsd`
  is a machine problem. A reboot, or `sudo killall fseventsd`, is the known
  remedy. Freeing disk space may also help.

