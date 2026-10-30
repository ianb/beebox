---
title: "Production box homes have files a sibling box user can read by path"
workstream: cross-box-leak-scan
area: deploy
labels: [security]
filed-by: agent
discovered-by: agent
discovered-in: "cross-box-leak-scan run 20261030-021243 (unit-host audit)"
---

The unit-host audit (`schedules/cross-box-leak-scan/host-audit-users.ts`)
found files with the "other" permission bits set under
`/var/lib/beebox/<slug>`. The home, `box/` and `box/.beebox/` are 0751, so
any account on the host that knows a file's name can read it. Inside a box
unit the sibling homes are hidden (Track C's view), so the exposure is to
processes that run outside a unit, for example a login shell as a box
user.

Files on 2026-10-30:

- `/var/lib/beebox/<slug>/.gitconfig`, 0664, in all seven production boxes. It
  holds the commit name and email. `add-box.sh` made it under the login
  shell's umask 002; the script now sets `umask 077` for that command, which
  fixes new boxes only.
- `/var/lib/beebox/mn-social-services/box/.beebox/notified-questions.json`,
  0664. It holds question card paths. The engine writes it with the unit's
  umask (0007), so this mode is from before the 2026-10-25 migration.
- `/var/lib/beebox/mn-social-services/box/node_modules`, 0775. It holds npm
  packages (not confidential), but the box root may be listed through it.

The migration and `add-box.sh` run `chmod -R go-rwx` on the box root only
when they run. Nothing re-asserts the modes after that.

## Fix

1. On the host, as root, remove the "other" bits from these files:
   `chmod o-rwx` on each path above. Run the audit again to confirm.
2. Decide if `deploy.sh` must re-assert `chmod -R o-rwx` on each box home
   (except `box/`, `box/.beebox/`, `hub-meta.json` and
   `quick-chat-home.snapshot.json`) on each deploy, the same way it
   re-asserts the cache directory mode.

The group bits (0660, 0640, 0770) that the same run reported are not a
leak: the group is `bbx-<slug>`, which has one member, and `UMask=0007` is
the documented posture. The audit now accepts them.
