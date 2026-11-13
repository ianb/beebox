---
title: "An installed scheduler launchd plist from an older CLI crash-loops silently"
workstream: unattached
area: beebox
labels: [scheduler, dev-environment]
filed-by: agent
discovered-by: Ian
discovered-in: "main checkout — local box schedules never ran, 2026-11-09"
---

The CLI split on 2026-09-27 (3b5d64ca0) moved `bbx scheduler start` to
`bbx engine scheduler start`. `bbx engine scheduler install` writes the new
command, but a plist installed before the split keeps the old one. On the
boxholder's Mac the daemon exited with `error: unknown command 'start'`,
launchd restarted it (`KeepAlive`), and no local box schedule ran for six
weeks. `~/.local/share/beebox/scheduler-stderr.log` grew to 17 MB of that
line. Nothing reported it.

Fixed by hand on 2026-11-09 by reinstalling the plist. What remains:

- `bbx engine scheduler status` should compare the installed plist's
  `ProgramArguments` with what `install` would write now, and say when they
  differ. It could also report a daemon whose last exit status is non-zero.
- `install` resolves the binary with `which bbx`. With no `bbx` on `PATH` it
  falls back to `process.argv[1]` and only warns.
- A stale-install check could run where the developer already looks, such as
  `bin/schedules list`, which reports scheduler health for the dev repo's own
  schedules.
