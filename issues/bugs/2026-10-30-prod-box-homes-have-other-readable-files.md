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
- `/var/lib/beebox/explorations/box/node_modules`, 0775 (found 2026-11-13).
  The cause of both node_modules modes: `deploy/server-bin/bbx-box-install`
  ran `pnpm install` as the box user through `sudo ... bash -lc`, which uses
  the login umask 002 (journal, deploy of 2026-11-11 21:37). The helper now
  runs under `umask 007` and removes the "other" bits from each box's
  top-level node_modules on each deploy. Fixed: after the deploy of
  2026-11-13 18:14 both trees are 0770, and every box's node_modules is
  0700 or 0770.

State on 2026-11-13 (after that deploy): six `.gitconfig` files were still
0664; `chmod o-rwx` by hand made them 0660 the same day (explorations is
0600). `mn-social-services`'s
`notified-questions.json` is still 0664; the engine now writes it 0600, so
its next rewrite tightens it.

The migration and `add-box.sh` run `chmod -R go-rwx` on the box root only
when they run. Nothing re-asserts the modes after that.

## Fix

1. On the host, as root, remove the "other" bits from these files:
   `chmod o-rwx` on each path above. Run the audit again to confirm.
2. Decided 2026-11-13: no periodic `chmod -R o-rwx` on deploy. A blind
   re-assert hides the writer that leaked. The weekly cross-box-leak-scan
   host audit reports a new open mode, and each finding gets its cause
   fixed (as with `bbx-box-install` and the `deploy.sh` umask).

The group bits (0660, 0640, 0770) that the same run reported are not a
leak: the group is `bbx-<slug>`, which has one member, and `UMask=0007` is
the documented posture. The audit now accepts them.

Done 2026-11-13: the `sudo -u bbx-<slug> -H bash -lc` calls in
`deploy/deploy.sh` (maintenance converge, migrate status and repair) now
start with `umask 007;`, as `bbx-box-install` does. They used the login
umask 002 and could write files in the box.
