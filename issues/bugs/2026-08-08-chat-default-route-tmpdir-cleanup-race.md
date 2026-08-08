---
title: "`chat-default-route.doctest.md` can fail on ENOTEMPTY/ENOENT tmp-dir cleanup under parallel suite load"
area: callback-box
filed-by: agent
discovered-in: worktree-member-password-reset — /finish full-suite verification for the file-watcher rapid-write flake fix
---

The full `pnpm test` suite intermittently fails
`test/webapp/chat-default-route.doctest.md` under parallel load:

```text
not ok 1 - chat-default-route.doctest.md:35 — await getDefaultSession() # time=58.598ms
not ok 2 - ENOTEMPTY: directory not empty, rmdir '/var/folders/.../cb-chat-default-U41J6o/.callback-box'
not ok 408 - test/webapp/chat-default-route.doctest.md # time=3695.573ms
```

The test's setup starts an async chat-session-history backfill
(`[chat-history:backfill] Scanning JSONLs for web chat sessions`) that writes a
tmp file and renames it into place. Under contention the test's own `rm` of the
box tmpdir can race that in-flight write, producing either `ENOTEMPTY` on the
directory removal or (seen on isolated reruns, non-fatal there) `ENOENT` on the
backfill's own rename — see
`[chat] session backfill failed: ENOENT: ... rename '.../chat-session-history.json.tmp-...' -> '.../chat-session-history.json'`.

The branch that surfaced this
(`worktree-member-password-reset`) did not touch this test or
`src/webapp/routes/chat.js`/chat-session-history backfill code. The file passed
2/2 immediately afterward in isolation with:

```sh
pnpm exec tap test/webapp/chat-default-route.doctest.md -j1
```

This is the same class of tmp-dir-cleanup-under-load race as the closed
[auth-command parallel state flake](../closed/bugs/2026-08-04-auth-command-doctest-parallel-state-flake.md)
and [publish-go parallel timeout](../closed/bugs/2026-08-04-publish-go-doctest-parallel-timeout.md).
Determine whether the test should await/disable the background backfill before
tearing down its tmpdir, or whether the backfill write itself needs to
tolerate a removed target directory.
