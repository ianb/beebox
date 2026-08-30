---
title: "`hub-e2e.doctest.md` binds the default hub port, so two worktrees running it at once collide"
workstream: watcher-flake
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-watcher-flake — full-suite verification of the file-watcher flake fix
resolution: implemented
---

Closed 2026-08-14. Fixed in the test; production behavior is unchanged.

`test/hub/hub-e2e.doctest.md` wrote a hub config with no `port` field, so the
spawned hub fell back to `DEFAULT_HUB_PORT` (4310). Several worktree sessions
run `pnpm test` concurrently on one machine as a matter of course, so two runs
fought over one port and the loser hung for the full 120-second startup timeout.
The diagnostic named the *build* step (line 116) rather than the bind failure,
because every step below shares one test via `continue` blocks.

## Fixes

- **The fixture claims a free port.** `pickFreePort()` binds `127.0.0.1:0`,
  reads the assigned port, closes the probe, and writes it into `hub.json`. A
  new assertion checks the hub reports the port it was given, so `hub.json`'s
  `port` field is now covered too.
- **The readiness wait fails immediately when the hub exits**, and reports the
  hub's own stdout and stderr with the failure.
- **`waitFor` takes a label**, so a timeout says what it was waiting for instead
  of blaming the first block of the shared test.
- **The cleanup block stops the hub.** The SIGTERM section is an assertion, not
  a teardown, so any earlier failure left the hub and its `bbx serve` grandchild
  running and holding the port. Cleanup now SIGTERMs (letting the hub stop its
  own child) and SIGKILLs only if it will not go.

## Verification

With a squatter holding 4310:

| | before | after |
| --- | --- | --- |
| test outcome | fails after 120.5 s, blames the build step | passes in ~6 s |

Forcing the bind to collide anyway (fixture pinned to the occupied 4310) fails
in **4.9 s** with `EADDRINUSE: address already in use 127.0.0.1:4310` in the
message, against 120 s of silence before.

Forcing a mid-test failure after the hub starts leaves **no** surviving hub
process; before, it left one. That guard depends on the doctest teardown fix in
`dc90a691` — without it the cleanup block was never registered.

## Not done: `port: 0` in `hub.json`

The original filing suggested the fixture bind port 0 directly. That needs a
production change and is not free: `cli/commands/hub.ts` builds `baseUrl` from
the configured port *before* `listen`, and `registerAuthRoutes` computes the
OAuth `redirectUri` once at registration. A hub configured with port 0 would
therefore advertise `http://127.0.0.1:0` as its redirect URI and break Google
login silently. Supporting it properly means resolving `baseUrl` after bind,
which is worth doing only if something actually wants an ephemeral hub —
nothing does today. `hub-config.ts`'s schema still rejects 0
(`z.number().int().positive()`), which is the honest state.
